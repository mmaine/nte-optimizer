import { describe, expect, it } from "vitest";

import { createLocalStorageAdapter, STATE_KEY, type StorageLike } from "../src/db/adapters/local-storage.ts";
import { createMemoryAdapter } from "../src/db/adapters/memory.ts";
import { emptyState, type StoredState } from "../src/db/adapters/types.ts";
import { exportDatabase, importDatabase } from "../src/db/dbfile.ts";
import { parseGearExport } from "../src/db/import.ts";
import { emptyCharacter, type EquipmentRow } from "../src/db/schema.ts";
import {
  applyImport,
  coveredCells,
  editItem,
  equip,
  equipmentOf,
  heldByOthers,
  isComplete,
  nameOwnerGroup,
  resolveCharacter,
  todoInGame,
  undoLast,
  unnamedGroups,
} from "../src/db/store.ts";

const row = (over: Partial<EquipmentRow> = {}): EquipmentRow => ({
  instance: "a1",
  ownerGroup: null,
  characterId: "Zankou",
  cells: [1, 2, 3],
  origin: "imported",
  batchId: "b1",
  at: 0,
  ...over,
});

function stateWith(equipment: EquipmentRow[], over: Partial<StoredState> = {}): StoredState {
  const state = emptyState();
  state.db.equipment = equipment;
  return { ...state, ...over };
}

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quota) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe("adapters", () => {
  it("memory round-trips and does not alias the caller's state", async () => {
    const adapter = createMemoryAdapter();
    const state = stateWith([row()]);
    await adapter.replaceAll(state);
    state.db.equipment[0]!.instance = "mutated";
    const read = await adapter.read();
    expect(read.db.equipment[0]!.instance).toBe("a1");
    expect(adapter.durable).toBe(false);
  });

  it("localStorage round-trips and survives a corrupt value", async () => {
    const storage = new FakeStorage();
    const adapter = createLocalStorageAdapter(storage);
    await adapter.replaceAll(stateWith([row()]));
    expect((await adapter.read()).db.equipment).toHaveLength(1);

    storage.data.set(STATE_KEY, "{ not json");
    expect((await adapter.read()).db.equipment).toEqual([]);
  });

  it("drops the snapshot before the database when the quota is hit", async () => {
    const storage = new FakeStorage();
    const adapter = createLocalStorageAdapter(storage);
    const state = stateWith([row()]);
    state.snapshot = { items: [], equipment: [], characters: [], ownerNames: [], meta: [] };
    await adapter.replaceAll(state);
    expect(storage.data.size).toBe(2);

    storage.quota = 200;
    await expect(adapter.replaceAll(state)).rejects.toThrow();
    // The database write is what matters; the snapshot is the first thing cut.
    expect(storage.getItem("nte-optimizer:snapshot")).toBeNull();
  });

  it("writes only equipment on the frequent path", async () => {
    const adapter = createMemoryAdapter();
    const state = stateWith([row()]);
    state.db.items = [
      { instance: "a1", kind: "module", itemId: "x", shape: null, cells: null, set: null, level: 0, rarity: "orange", mainStats: [], substats: [] },
    ];
    await adapter.replaceAll(state);
    await adapter.writeEquipment([row({ instance: "a2" })], []);
    const read = await adapter.read();
    expect(read.db.equipment.map((r) => r.instance)).toEqual(["a2"]);
    expect(read.db.items).toHaveLength(1);
  });
});

describe("store", () => {
  it("resolves a character through the owner group, never off the row", () => {
    const state = nameOwnerGroup(stateWith([row({ characterId: null, ownerGroup: "g1" })]), "g1", "Sagiri");
    const [equipped] = state.db.equipment;
    expect(equipped!.characterId).toBeNull();
    expect(resolveCharacter(equipped!, state.db.ownerNames)).toBe("Sagiri");
    expect(equipmentOf(state.db, "Sagiri")).toHaveLength(1);
  });

  it("lists groups nobody has named", () => {
    const state = stateWith([
      row({ characterId: null, ownerGroup: "g1" }),
      row({ instance: "a2", characterId: null, ownerGroup: "g2" }),
    ]);
    expect(unnamedGroups(state.db)).toEqual(["g1", "g2"]);
    expect(unnamedGroups(nameOwnerGroup(state, "g1", "Zankou").db)).toEqual(["g2"]);
  });

  it("calls a build incomplete when it no longer covers twenty cells", () => {
    const full = [row({ cells: new Array(20).fill(0) })];
    expect(coveredCells(full)).toBe(20);
    expect(isComplete(full)).toBe(true);
    expect(isComplete([row({ cells: [1, 2] })])).toBe(false);
  });

  it("replaces a character's whole loadout in one action", () => {
    const state = stateWith([row({ instance: "old1" }), row({ instance: "old2" })]);
    const { state: next } = equip(state, "Zankou", ["new1", "new2"]);
    expect(equipmentOf(next.db, "Zankou").map((r) => r.instance).sort()).toEqual(["new1", "new2"]);
    expect(next.undo).toHaveLength(1);
    expect(next.undo[0]!.before.map((r) => r.instance).sort()).toEqual(["old1", "old2"]);
  });

  it("names who was left with a hole when it takes their item", () => {
    const state = stateWith([
      row({ instance: "shared", characterId: "Haniel" }),
      row({ instance: "other", characterId: "Haniel" }),
    ]);
    const { state: next, displaced } = equip(state, "Zankou", ["shared"]);
    expect(displaced).toEqual([{ characterId: "Haniel", instances: ["shared"] }]);
    // Haniel keeps everything else, and is now incomplete rather than wiped.
    expect(equipmentOf(next.db, "Haniel").map((r) => r.instance)).toEqual(["other"]);
  });

  it("restores both sides of a steal with one undo", () => {
    const state = stateWith([
      row({ instance: "shared", characterId: "Haniel" }),
      row({ instance: "mine", characterId: "Zankou" }),
    ]);
    const { state: next } = equip(state, "Zankou", ["shared"]);
    const back = undoLast(next);
    expect(equipmentOf(back.db, "Haniel").map((r) => r.instance)).toEqual(["shared"]);
    expect(equipmentOf(back.db, "Zankou").map((r) => r.instance)).toEqual(["mine"]);
    expect(back.undo).toHaveLength(0);
  });

  it("marks app-assigned rows as things still to do in game", () => {
    const state = stateWith([row({ instance: "worn" })]);
    const { state: next } = equip(state, "Zankou", ["planned"]);
    const todo = todoInGame(next.db);
    expect(todo.get("Zankou")!.map((r) => r.instance)).toEqual(["planned"]);
    expect(todoInGame(state.db).size).toBe(0);
  });
});

describe("import application", () => {
  const gearExport = {
    format: "nte-gear-export",
    format_version: 1,
    scan: { cartridges: 0, modules: 1 },
    exporter: { version: "0.4.0" },
    characters: [{ key: "Zankou", level: 70, breakthroughs: 5 }],
    items: [
      {
        instance: "a1",
        kind: "module",
        item_id: "cell3_style6_1_Orange",
        shape: "cell3_style6",
        level: 20,
        rarity: "orange",
        main_stats: [],
        substats: [{ stat: "CritBase", value: 0.06 }],
        owner_group: "g1",
      },
    ],
  };

  it("snapshots, replaces gear, and leaves owner names alone", () => {
    let state = stateWith([row({ instance: "stale" })]);
    state = nameOwnerGroup(state, "g1", "Zankou");
    state.db.characters = [{ ...emptyCharacter("Zankou"), arcId: "fork_vine", level: 60 }];
    state.undo = [{ batchId: "b", before: [], after: [], at: 0 }];

    const next = applyImport(state, parseGearExport(gearExport));
    expect(next.db.items).toHaveLength(1);
    expect(next.db.equipment.map((r) => r.instance)).toEqual(["a1"]);
    expect(next.db.ownerNames).toHaveLength(1);
    expect(next.db.characters[0]!.arcId).toBe("fork_vine");
    expect(next.db.characters[0]!.level).toBe(70);
    // Undo refers to items that may no longer exist.
    expect(next.undo).toEqual([]);
    expect(next.snapshot!.equipment.map((r) => r.instance)).toEqual(["stale"]);
  });

  it("refuses to apply a failed import", () => {
    const bad = parseGearExport({ format: "nope" });
    expect(() => applyImport(emptyState(), bad)).toThrow();
  });
});

describe("database file", () => {
  it("round-trips the whole workspace", () => {
    const state = nameOwnerGroup(stateWith([row()]), "g1", "Zankou");
    const file = exportDatabase(state, "2026-08-21");
    const back = importDatabase(JSON.parse(JSON.stringify(file)));
    expect(back.ok).toBe(true);
    expect(back.migrated).toBe(false);
    expect(back.state!.db.ownerNames).toHaveLength(1);
    expect(back.state!.db.equipment).toHaveLength(1);
  });

  it("refuses a file from a newer build rather than dropping fields", () => {
    const file = exportDatabase(emptyState(), null);
    const newer = { ...file, schema_version: 99 };
    const result = importDatabase(newer);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("newer build");
  });

  it("refuses anything that is not a database file", () => {
    expect(importDatabase({ format: "nte-gear-export" }).ok).toBe(false);
    expect(importDatabase(null).ok).toBe(false);
  });
});

describe("use equipped items", () => {
  it("locks away only what a resolvable other character is wearing", () => {
    let state = stateWith([
      row({ instance: "mine", characterId: "Zankou" }),
      row({ instance: "theirs", characterId: "Haniel" }),
      row({ instance: "unnamed", characterId: null, ownerGroup: "g9" }),
    ]);
    // Zankou keeps their own; Haniel's is off limits.
    expect(heldByOthers(state.db, ["Zankou"])).toEqual(["theirs"]);
    // Both team members' items are available to the team.
    expect(heldByOthers(state.db, ["Zankou", "Haniel"])).toEqual([]);

    // An unresolved group belongs to nobody the app can reason about, so it
    // stays available rather than hiding most of the pool.
    state = nameOwnerGroup(state, "g9", "Adler");
    expect(heldByOthers(state.db, ["Zankou"]).sort()).toEqual(["theirs", "unnamed"]);
  });
});

describe("editing an item by hand", () => {
  it("corrects a value and leaves the rest alone", () => {
    const state = emptyState();
    state.db.items = [
      {
        instance: "a1",
        kind: "module",
        itemId: "cell3_style6_1_Orange",
        shape: "cell3_style6",
        cells: 3,
        set: null,
        level: 0,
        rarity: "orange",
        mainStats: [],
        substats: [{ stat: "CritBase", value: 0.03 }],
      },
    ];
    const next = editItem(state, "a1", {
      level: 20,
      substats: [{ stat: "CritBase", value: 0.06 }],
    });
    expect(next.db.items[0]!.level).toBe(20);
    expect(next.db.items[0]!.substats[0]!.value).toBe(0.06);
    expect(next.db.items[0]!.shape).toBe("cell3_style6");
    // The original is untouched: state is replaced, never mutated.
    expect(state.db.items[0]!.level).toBe(0);
  });

  it("cannot be used to change an item's identity", () => {
    const state = emptyState();
    state.db.items = [
      {
        instance: "a1", kind: "module", itemId: "x", shape: null, cells: null,
        set: null, level: 0, rarity: "orange", mainStats: [], substats: [],
      },
    ];
    const next = editItem(state, "a1", { level: 5 } as never);
    expect(next.db.items[0]!.instance).toBe("a1");
  });
});

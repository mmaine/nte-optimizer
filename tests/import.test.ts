import { describe, expect, it } from "vitest";

import { emptyCharacter } from "../src/db/schema.ts";
import { mergeCharacters, parseGearExport } from "../src/db/import.ts";

const item = (over: Record<string, unknown> = {}) => ({
  instance: "a1",
  kind: "module",
  item_id: "cell3_style6_1_Orange",
  shape: "cell3_style6",
  level: 20,
  rarity: "orange",
  main_stats: [{ stat: "HPMaxAdd", value: 840 }],
  substats: [{ stat: "CritBase", value: 0.06 }],
  owner_group: null,
  ...over,
});

const gearExport = (over: Record<string, unknown> = {}) => ({
  format: "nte-gear-export",
  format_version: 1,
  scan: { cartridges: 0, modules: 1, characters: 0, characters_with_loadouts: 0, warnings: [] },
  exporter: { name: "nte-history-exporter", version: "0.4.0" },
  user_uid: "100200300",
  characters: [],
  items: [item()],
  ...over,
});

describe("gear export import", () => {
  it("accepts a well-formed export", () => {
    const result = parseGearExport(gearExport());
    expect(result.ok).toBe(true);
    expect(result.report.parsed).toBe(1);
    expect(result.report.rejected).toBe(0);
    expect(result.rows!.items[0]!.cells).toBe(3);
    expect(result.rows!.userUid).toBe("100200300");
    expect(result.rows!.exporterVersion).toBe("0.4.0");
  });

  it("refuses a file that is not a gear export", () => {
    expect(parseGearExport({ format: "nte-achievement-export" }).ok).toBe(false);
    expect(parseGearExport(gearExport({ format_version: 2 })).ok).toBe(false);
    expect(parseGearExport("not json at all").ok).toBe(false);
  });

  it("writes nothing at all when one record is bad", () => {
    // Fail closed: a half-imported account is worse than a refused import.
    const result = parseGearExport(
      gearExport({
        scan: { cartridges: 0, modules: 2 },
        items: [item(), item({ instance: "a2", level: 99 })],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.rows).toBeUndefined();
    expect(result.report.rejected).toBe(1);
    expect(result.report.problems.map((p) => p.code)).toContain("bad_level");
  });

  it("reports a diff rather than a silent count", () => {
    const result = parseGearExport(
      gearExport({ scan: { cartridges: 0, modules: 3 }, items: [item()] }),
    );
    expect(result.ok).toBe(false);
    expect(result.report.expected).toBe(3);
    expect(result.report.parsed).toBe(1);
    expect(result.report.problems.map((p) => p.code)).toContain("count_mismatch");
  });

  it("rejects a duplicate instance instead of overwriting it", () => {
    // `instance` is the primary key, so a duplicate would silently vanish.
    const result = parseGearExport(
      gearExport({ scan: { cartridges: 0, modules: 2 }, items: [item(), item()] }),
    );
    expect(result.ok).toBe(false);
    expect(result.report.problems.map((p) => p.code)).toContain("duplicate_instance");
  });

  it("rejects a stat the model has no slot for", () => {
    const result = parseGearExport(
      gearExport({ items: [item({ substats: [{ stat: "MadeUpStat", value: 1 }] })] }),
    );
    expect(result.ok).toBe(false);
    expect(result.report.problems.map((p) => p.code)).toContain("unknown_stat");
  });

  it("allows a null main-stat value but not a null substat", () => {
    // The game never transmits a main stat's displayed value.
    expect(
      parseGearExport(gearExport({ items: [item({ main_stats: [{ stat: "HPMaxAdd", value: null }] })] }))
        .ok,
    ).toBe(true);
    expect(
      parseGearExport(gearExport({ items: [item({ substats: [{ stat: "CritBase", value: null }] })] }))
        .ok,
    ).toBe(false);
  });

  it("rejects a module whose shape is unknown", () => {
    const result = parseGearExport(gearExport({ items: [item({ shape: "cell9_style9" })] }));
    expect(result.ok).toBe(false);
    expect(result.report.problems.map((p) => p.code)).toContain("unknown_shape");
  });

  it("resolves a cartridge's set from its packet id", () => {
    const result = parseGearExport(
      gearExport({
        scan: { cartridges: 1, modules: 0 },
        items: [
          item({
            instance: "c1",
            kind: "cartridge",
            item_id: "Psyche_orange",
            shape: undefined,
            main_stats: [{ stat: "CritDamageBase", value: 0.6 }],
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    // Psyche, not Blood: the id the game actually uses.
    expect(result.rows!.items[0]!.set).toBe("Devil's Blood: Curse");
  });

  it("turns an owner group into an equipment row without naming a character", () => {
    const result = parseGearExport(gearExport({ items: [item({ owner_group: "0000000d0d" })] }));
    expect(result.ok).toBe(true);
    const [row] = result.rows!.equipment;
    expect(row!.ownerGroup).toBe("0000000d0d");
    // The name attached to a group is a guess until the player makes it.
    expect(row!.characterId).toBeNull();
    expect(row!.origin).toBe("imported");
  });

  it("leaves unequipped items out of the equipment store", () => {
    const result = parseGearExport(gearExport());
    expect(result.rows!.equipment).toEqual([]);
  });
});

describe("character merge", () => {
  it("refreshes level and ascension but keeps the player's configuration", () => {
    const stored = {
      ...emptyCharacter("Zankou"),
      level: 60,
      breakthroughs: 3,
      arcId: "fork_vine",
      arcRefinement: 2,
      useCustom: true,
      customTargets: [{ stat: "CritBase", target: 0.7, weight: 3 }],
    };
    const [merged] = mergeCharacters(
      [stored],
      [{ ...emptyCharacter("Zankou"), level: 70, breakthroughs: 5 }],
    );
    expect(merged!.level).toBe(70);
    expect(merged!.breakthroughs).toBe(5);
    expect(merged!.arcId).toBe("fork_vine");
    expect(merged!.arcRefinement).toBe(2);
    expect(merged!.useCustom).toBe(true);
    expect(merged!.customTargets).toHaveLength(1);
  });

  it("keeps a character the capture did not mention", () => {
    const stored = { ...emptyCharacter("Oneiroi"), arcId: "fork_dustbin" };
    const merged = mergeCharacters([stored], [emptyCharacter("Zankou")]);
    expect(merged.map((row) => row.characterId).sort()).toEqual(["Oneiroi", "Zankou"]);
    expect(merged.find((row) => row.characterId === "Oneiroi")!.arcId).toBe("fork_dustbin");
  });
});

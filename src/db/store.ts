/**
 * The in-memory mirror and the operations that change it.
 *
 * IndexedDB is the durable log; this is the query engine. Everything is loaded
 * at boot - well under 5 MB - and filtered and sorted in JS, because substat
 * filters are not indexable in IndexedDB anyway.
 */
import { mergeCharacters, type ImportResult } from "./import.ts";
import {
  UNDO_LIMIT,
  type Database,
  type EquipmentRow,
  type ItemRow,
  type OwnerNameRow,
  type UndoRow,
} from "./schema.ts";
import type { PersistenceAdapter, StoredState } from "./adapters/types.ts";

/** How many cells a complete board covers. */
export const BOARD_CELLS = 20;

export interface EquipOptions {
  /** Cells each instance covers, when a packing decided them. */
  cells?: Record<string, number[]>;
  now?: () => number;
  newBatchId?: () => string;
}

export interface EquipOutcome {
  state: StoredState;
  /**
   * Characters left with a hole because this equip took an item they were
   * wearing. Their build is `incomplete` - covered cells no longer total 20 -
   * and the confirmation dialog has to name them and the piece before it runs.
   */
  displaced: Array<{ characterId: string; instances: string[] }>;
}

/** The character wearing a row: stored directly, or resolved through the group. */
export function resolveCharacter(
  row: EquipmentRow,
  ownerNames: readonly OwnerNameRow[],
): string | null {
  if (row.characterId) return row.characterId;
  if (!row.ownerGroup) return null;
  return ownerNames.find((name) => name.ownerGroup === row.ownerGroup)?.characterId ?? null;
}

export function equipmentOf(
  db: Database,
  characterId: string,
): EquipmentRow[] {
  return db.equipment.filter((row) => resolveCharacter(row, db.ownerNames) === characterId);
}

/** Covered cells, when the rows carry them. A complete build totals 20. */
export function coveredCells(rows: readonly EquipmentRow[]): number {
  let total = 0;
  for (const row of rows) total += row.cells?.length ?? 0;
  return total;
}

export function isComplete(rows: readonly EquipmentRow[]): boolean {
  return coveredCells(rows) === BOARD_CELLS;
}

/**
 * Rows the player has not actually applied in game yet.
 *
 * `origin` does all the work: after the next import these vanish on their own,
 * because either you did it or you didn't. There is no reconciliation logic and
 * there does not need to be.
 */
export function todoInGame(db: Database): Map<string, EquipmentRow[]> {
  const out = new Map<string, EquipmentRow[]>();
  for (const row of db.equipment) {
    if (row.origin !== "app") continue;
    const character = resolveCharacter(row, db.ownerNames) ?? "";
    const bucket = out.get(character);
    if (bucket) bucket.push(row);
    else out.set(character, [row]);
  }
  return out;
}

/**
 * Correct one item by hand.
 *
 * The decode is good but not infallible, and a player who spots a wrong value
 * needs to fix it rather than work around it. The edit is stored like any other
 * row, so the **next import overwrites it** - which is right: the import is the
 * game speaking, and a correction that outlived the thing it corrected would be
 * worse than losing it.
 */
export function editItem(
  state: StoredState,
  instance: string,
  patch: Partial<Omit<ItemRow, "instance">>,
): StoredState {
  const items = state.db.items.map((row) =>
    row.instance === instance ? { ...row, ...patch, instance } : row,
  );
  return { ...state, db: { ...state.db, items } };
}

/**
 * Instances worn by anyone other than these characters.
 *
 * This is R2's toggle turned **off**: no item may be taken from another
 * character. With the toggle on the solve sees the whole pool, which is why the
 * team solve has to name whoever is left with a hole.
 *
 * An item with no resolvable owner is *not* excluded: the capture says it is
 * worn, but until the player names that owner group it belongs to nobody the app
 * can reason about, and locking it away would hide most of the pool.
 */
export function heldByOthers(
  db: Database,
  characterIds: readonly string[],
): string[] {
  const mine = new Set(characterIds);
  const out: string[] = [];
  for (const row of db.equipment) {
    const owner = resolveCharacter(row, db.ownerNames);
    if (owner !== null && !mine.has(owner)) out.push(row.instance);
  }
  return out;
}

/**
 * Apply an import.
 *
 * Items and equipment are replaced outright; the pre-import snapshot is taken
 * first; character configuration is merged rather than overwritten; owner names
 * are left completely alone; undo is cleared, because its rows refer to items
 * that may no longer exist.
 */
export function applyImport(
  state: StoredState,
  result: ImportResult,
  now = Date.now,
): StoredState {
  if (!result.ok || !result.rows) throw new Error("refusing to apply a failed import");
  const { items, equipment, characters, userUid, serverId, exporterVersion } = result.rows;

  const meta = state.db.meta.filter(
    (row) => !["lastImport", "userUid", "serverId", "exporterVersion"].includes(row.key),
  );
  meta.push(
    { key: "lastImport", value: now() },
    { key: "userUid", value: userUid },
    { key: "serverId", value: serverId },
    { key: "exporterVersion", value: exporterVersion },
  );

  return {
    snapshot: structuredClone(state.db),
    undo: [],
    db: {
      items,
      equipment,
      characters: mergeCharacters(state.db.characters, characters),
      ownerNames: state.db.ownerNames,
      meta,
    },
  };
}

/**
 * Equip a set of items on one character, as one atomic change.
 *
 * Both sides of the move go into a **single** undo entry: the character's old
 * rows and any rows taken from someone else. One undo then restores both, which
 * is the only behaviour that is not surprising.
 */
export function equip(
  state: StoredState,
  characterId: string,
  instances: readonly string[],
  options: EquipOptions = {},
): EquipOutcome {
  const now = options.now ?? Date.now;
  const at = now();
  const batchId = options.newBatchId?.() ?? `equip-${at}-${characterId}`;
  const wanted = new Set(instances);

  const before: EquipmentRow[] = [];
  const displacedBy = new Map<string, string[]>();

  const kept = state.db.equipment.filter((row) => {
    const owner = resolveCharacter(row, state.db.ownerNames);
    if (owner === characterId) {
      before.push(row);
      return false;
    }
    if (wanted.has(row.instance)) {
      before.push(row);
      if (owner) {
        const bucket = displacedBy.get(owner);
        if (bucket) bucket.push(row.instance);
        else displacedBy.set(owner, [row.instance]);
      }
      return false;
    }
    return true;
  });

  const after: EquipmentRow[] = instances.map((instance) => ({
    instance,
    ownerGroup: null,
    characterId,
    cells: options.cells?.[instance] ?? null,
    origin: "app",
    batchId,
    at,
  }));

  const undo: UndoRow[] = [...state.undo, { batchId, before, after, at }].slice(-UNDO_LIMIT);

  return {
    state: { ...state, db: { ...state.db, equipment: [...kept, ...after] }, undo },
    displaced: [...displacedBy].map(([id, list]) => ({ characterId: id, instances: list })),
  };
}

/** Reverse the most recent equip, both sides of it. */
export function undoLast(state: StoredState): StoredState {
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return state;
  const removed = new Set(entry.after.map((row) => row.instance));
  const equipment = state.db.equipment.filter((row) => !removed.has(row.instance));
  const restored = entry.before.filter(
    (row) => !equipment.some((existing) => existing.instance === row.instance),
  );
  return {
    ...state,
    db: { ...state.db, equipment: [...equipment, ...restored] },
    undo: state.undo.slice(0, -1),
  };
}

/**
 * Name an owner group.
 *
 * Keyed by the group, which is stable across exports, so this is answered once
 * ever rather than once per import - and the name is never written onto an
 * equipment row.
 */
export function nameOwnerGroup(
  state: StoredState,
  ownerGroup: string,
  characterId: string,
  now = Date.now,
): StoredState {
  const ownerNames = state.db.ownerNames.filter((row) => row.ownerGroup !== ownerGroup);
  ownerNames.push({ ownerGroup, characterId, at: now() });
  return { ...state, db: { ...state.db, ownerNames } };
}

/** Groups the capture found that nobody has named yet. */
export function unnamedGroups(db: Database): string[] {
  const named = new Set(db.ownerNames.map((row) => row.ownerGroup));
  const groups = new Set<string>();
  for (const row of db.equipment) {
    if (row.ownerGroup && !named.has(row.ownerGroup)) groups.add(row.ownerGroup);
  }
  return [...groups].sort();
}

export async function persist(
  adapter: PersistenceAdapter,
  state: StoredState,
  scope: "all" | "equipment",
): Promise<void> {
  if (scope === "all") await adapter.replaceAll(state);
  else await adapter.writeEquipment(state.db.equipment, state.undo);
}

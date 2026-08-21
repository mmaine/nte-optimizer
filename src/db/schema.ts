/**
 * The local database.
 *
 * One IndexedDB database, integer-versioned with explicit migrations. Treated as
 * a **durable log, not a query engine**: everything is loaded into memory at
 * boot - well under 5 MB at 817 items - and filtered and sorted in JS. Substat
 * filters are not indexable in IndexedDB anyway, so one index carries the whole
 * schema and it stops churning.
 */

export const DB_NAME = "nte-optimizer";
export const DB_VERSION = 1;

export const STORES = {
  /** Cleared and replaced on import. Keyed by `instance`. */
  items: "items",
  /**
   * Cleared and replaced on import. Keyed by `instance` too - an item is worn in
   * exactly one place, so the primary key makes double-equipping structurally
   * impossible rather than merely something to test for.
   */
  equipment: "equipment",
  /**
   * Level and ascension are refreshed by import; the Arc, refinement, effect
   * toggles, build variant, custom targets and priorities are preserved.
   */
  characters: "characters",
  /** Named once by the player and **never touched by import**. */
  ownerNames: "ownerNames",
  /** Bounded ring of equipment changes. Cleared by import. */
  undo: "undo",
  /** The last pre-import dump, so a wrong file is a click to undo. */
  snapshots: "snapshots",
  meta: "meta",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export const ITEM_KIND_INDEX = "by_kind";

export interface ItemRow {
  instance: string;
  kind: "module" | "cartridge";
  itemId: string;
  shape: string | null;
  cells: number | null;
  set: string | null;
  level: number;
  rarity: string;
  mainStats: Array<{ stat: string; value: number | null }>;
  substats: Array<{ stat: string; value: number }>;
}

export type EquipmentOrigin = "imported" | "app";

export interface EquipmentRow {
  instance: string;
  /**
   * Resolved through `ownerNames` at read time and null when unknown. The
   * character's name is **never** stored on the row: the owner group is exact,
   * the name attached to it is a guess until the player makes it.
   */
  ownerGroup: string | null;
  characterId: string | null;
  /** Board cells this item covers, or null when the capture did not say. */
  cells: number[] | null;
  /** `imported` means the game says so; `app` means you have not done it yet. */
  origin: EquipmentOrigin;
  /** Shared by every row written in one equip action, so undo is one entry. */
  batchId: string;
  at: number;
}

export interface CharacterRow {
  characterId: string;
  /** Refreshed by import. */
  level: number | null;
  breakthroughs: number | null;
  /** Preserved across imports. */
  arcId: string | null;
  arcRefinement: number;
  effectToggles: Record<string, boolean | number>;
  buildVariant: string | null;
  customTargets: Array<{ stat: string; target: number; weight: number }> | null;
  useCustom: boolean;
  /**
   * What the game actually shows, read off-team and typed in by the player.
   *
   * The stat model has measured gaps, so a permanent predicted-vs-actual panel
   * is how drift gets caught by the player instead of being trusted silently.
   */
  measuredSheet: Record<string, number> | null;
}

export interface OwnerNameRow {
  ownerGroup: string;
  characterId: string;
  at: number;
}

export interface UndoRow {
  id?: number;
  batchId: string;
  before: EquipmentRow[];
  after: EquipmentRow[];
  at: number;
}

export const UNDO_LIMIT = 50;

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface Database {
  items: ItemRow[];
  equipment: EquipmentRow[];
  characters: CharacterRow[];
  ownerNames: OwnerNameRow[];
  meta: MetaRow[];
}

export function emptyCharacter(characterId: string): CharacterRow {
  return {
    characterId,
    level: null,
    breakthroughs: null,
    arcId: null,
    arcRefinement: 0,
    effectToggles: {},
    buildVariant: null,
    customTargets: null,
    useCustom: false,
    measuredSheet: null,
  };
}

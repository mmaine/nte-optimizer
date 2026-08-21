/**
 * Where the database actually lives.
 *
 * Three tiers, one interface: IndexedDB normally, `localStorage` when a
 * `file://` document's opaque origin denies IndexedDB, and memory when even that
 * is refused. The app never sees through this - it asks for the state and hands
 * back a new one - so the degraded modes cost nothing above the adapter beyond a
 * banner telling the player their data is not durable.
 */
import type { Database, EquipmentRow, UndoRow } from "../schema.ts";

export interface StoredState {
  db: Database;
  undo: UndoRow[];
  /** The last pre-import dump. One click back from a wrong file. */
  snapshot: Database | null;
}

export interface PersistenceAdapter {
  readonly kind: "idb" | "localStorage" | "memory";
  /** False in the degraded tiers, where the UI must say so. */
  readonly durable: boolean;
  read: () => Promise<StoredState>;
  /** Replace everything atomically: import, or a database restore. */
  replaceAll: (state: StoredState) => Promise<void>;
  /**
   * The frequent path. Equipping changes equipment and undo and nothing else,
   * so rewriting 817 item rows for it would be pure waste.
   */
  writeEquipment: (equipment: EquipmentRow[], undo: UndoRow[]) => Promise<void>;
  close: () => void;
}

export function emptyState(): StoredState {
  return {
    db: { items: [], equipment: [], characters: [], ownerNames: [], meta: [] },
    undo: [],
    snapshot: null,
  };
}

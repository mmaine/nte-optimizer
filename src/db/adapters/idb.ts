/**
 * The normal tier.
 *
 * One database, integer-versioned, with explicit migrations in `upgrade`.
 *
 * The rule that governs every write here: **an IndexedDB transaction
 * auto-commits the moment you await anything that is not an IndexedDB request.**
 * So each transaction body below is a straight run of `store.clear()` and
 * `store.put()` calls with a single await on `tx.done` at the end. Nothing else
 * may creep in - not a `structuredClone`, not a progress callback - or the
 * transaction closes underneath the remaining writes and the import lands half
 * applied.
 */
import { openDB, type IDBPDatabase } from "idb";

import {
  DB_NAME,
  DB_VERSION,
  ITEM_KIND_INDEX,
  STORES,
  UNDO_LIMIT,
  type EquipmentRow,
  type UndoRow,
} from "../schema.ts";
import { emptyState, type PersistenceAdapter, type StoredState } from "./types.ts";

const SNAPSHOT_KEY = "preImport";

export async function openDatabase(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Migrations are explicit and additive; each `if` is one version step.
      if (oldVersion < 1) {
        const items = db.createObjectStore(STORES.items, { keyPath: "instance" });
        items.createIndex(ITEM_KIND_INDEX, "kind");
        // Keyed on `instance`: an item is worn in exactly one place, and the
        // primary key is what enforces it.
        db.createObjectStore(STORES.equipment, { keyPath: "instance" });
        db.createObjectStore(STORES.characters, { keyPath: "characterId" });
        db.createObjectStore(STORES.ownerNames, { keyPath: "ownerGroup" });
        db.createObjectStore(STORES.undo, { keyPath: "id", autoIncrement: true });
        db.createObjectStore(STORES.snapshots);
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
    },
  });
}

export function createIdbAdapter(db: IDBPDatabase): PersistenceAdapter {
  return {
    kind: "idb",
    durable: true,

    async read(): Promise<StoredState> {
      const [items, equipment, characters, ownerNames, meta, undo, snapshot] =
        await Promise.all([
          db.getAll(STORES.items),
          db.getAll(STORES.equipment),
          db.getAll(STORES.characters),
          db.getAll(STORES.ownerNames),
          db.getAll(STORES.meta),
          db.getAll(STORES.undo),
          db.get(STORES.snapshots, SNAPSHOT_KEY),
        ]);
      const state = emptyState();
      state.db = { items, equipment, characters, ownerNames, meta };
      state.undo = undo as UndoRow[];
      state.snapshot = (snapshot as StoredState["snapshot"]) ?? null;
      return state;
    },

    async replaceAll(next: StoredState): Promise<void> {
      const tx = db.transaction(
        [
          STORES.items,
          STORES.equipment,
          STORES.characters,
          STORES.ownerNames,
          STORES.undo,
          STORES.snapshots,
          STORES.meta,
        ],
        "readwrite",
      );
      // Synchronous from here to `tx.done`.
      const snapshots = tx.objectStore(STORES.snapshots);
      if (next.snapshot) void snapshots.put(next.snapshot, SNAPSHOT_KEY);
      else void snapshots.delete(SNAPSHOT_KEY);

      const items = tx.objectStore(STORES.items);
      void items.clear();
      for (const row of next.db.items) void items.put(row);

      const equipment = tx.objectStore(STORES.equipment);
      void equipment.clear();
      for (const row of next.db.equipment) void equipment.put(row);

      const characters = tx.objectStore(STORES.characters);
      void characters.clear();
      for (const row of next.db.characters) void characters.put(row);

      // Never touched by import - the player named these once, and the values
      // they key on are stable across exports.
      const ownerNames = tx.objectStore(STORES.ownerNames);
      void ownerNames.clear();
      for (const row of next.db.ownerNames) void ownerNames.put(row);

      const undo = tx.objectStore(STORES.undo);
      void undo.clear();
      for (const row of next.undo.slice(-UNDO_LIMIT)) void undo.put(row);

      const meta = tx.objectStore(STORES.meta);
      void meta.clear();
      for (const row of next.db.meta) void meta.put(row);

      await tx.done;
    },

    async writeEquipment(rows: EquipmentRow[], undoRows: UndoRow[]): Promise<void> {
      const tx = db.transaction([STORES.equipment, STORES.undo], "readwrite");
      const equipment = tx.objectStore(STORES.equipment);
      void equipment.clear();
      for (const row of rows) void equipment.put(row);
      const undo = tx.objectStore(STORES.undo);
      void undo.clear();
      for (const row of undoRows.slice(-UNDO_LIMIT)) void undo.put(row);
      await tx.done;
    },

    close() {
      db.close();
    },
  };
}

/**
 * IndexedDB, then `localStorage`, then memory.
 *
 * Each tier is tried by *using* it, not by feature detection: on a `file://`
 * page `indexedDB` is a defined global that throws on `open`, and `localStorage`
 * can be present but throw on `setItem`.
 */
export async function createBestAdapter(): Promise<PersistenceAdapter> {
  try {
    return createIdbAdapter(await openDatabase());
  } catch {
    // Fall through.
  }
  try {
    const storage = globalThis.localStorage;
    const probe = "nte-optimizer:probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    const { createLocalStorageAdapter } = await import("./local-storage.ts");
    return createLocalStorageAdapter(storage);
  } catch {
    // Fall through.
  }
  const { createMemoryAdapter } = await import("./memory.ts");
  return createMemoryAdapter();
}

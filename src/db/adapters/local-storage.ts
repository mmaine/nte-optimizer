/**
 * The `file://` tier.
 *
 * Chrome gives a `file://` document an opaque origin, so IndexedDB is gone but
 * `localStorage` sometimes survives. It is synchronous and small, so the whole
 * database is one key and the snapshot is another - a snapshot is about a
 * megabyte, which is most of the budget, so it is dropped first when the quota
 * is hit rather than failing the write.
 */
import { emptyState, type PersistenceAdapter, type StoredState } from "./types.ts";
import type { EquipmentRow, UndoRow } from "../schema.ts";

export const STATE_KEY = "nte-optimizer:state";
export const SNAPSHOT_KEY = "nte-optimizer:snapshot";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function createLocalStorageAdapter(storage: StorageLike): PersistenceAdapter {
  const readState = (): StoredState => {
    const raw = storage.getItem(STATE_KEY);
    if (!raw) return emptyState();
    try {
      const parsed = JSON.parse(raw) as StoredState;
      const snapshotRaw = storage.getItem(SNAPSHOT_KEY);
      parsed.snapshot = snapshotRaw ? (JSON.parse(snapshotRaw) as StoredState["db"]) : null;
      return parsed;
    } catch {
      // A corrupt value is not worth a crash on boot; start clean.
      return emptyState();
    }
  };

  const write = (state: StoredState): void => {
    const { snapshot, ...rest } = state;
    try {
      storage.setItem(STATE_KEY, JSON.stringify({ ...rest, snapshot: null }));
    } catch (error) {
      // Out of quota: the snapshot is the largest thing here and the least
      // essential, so it goes before the database does.
      storage.removeItem(SNAPSHOT_KEY);
      storage.setItem(STATE_KEY, JSON.stringify({ ...rest, snapshot: null }));
      throw error;
    }
    if (snapshot) {
      try {
        storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      } catch {
        storage.removeItem(SNAPSHOT_KEY);
      }
    } else {
      storage.removeItem(SNAPSHOT_KEY);
    }
  };

  return {
    kind: "localStorage",
    durable: false,
    async read() {
      return readState();
    },
    async replaceAll(next) {
      write(next);
    },
    async writeEquipment(equipment: EquipmentRow[], undo: UndoRow[]) {
      const state = readState();
      write({ ...state, db: { ...state.db, equipment }, undo });
    },
    close() {},
  };
}

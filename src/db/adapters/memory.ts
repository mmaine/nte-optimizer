/** Last resort: the state lives only as long as the tab does. */
import { emptyState, type PersistenceAdapter, type StoredState } from "./types.ts";
import type { EquipmentRow, UndoRow } from "../schema.ts";

export function createMemoryAdapter(initial?: StoredState): PersistenceAdapter {
  let state = initial ?? emptyState();
  return {
    kind: "memory",
    durable: false,
    async read() {
      return structuredClone(state);
    },
    async replaceAll(next) {
      state = structuredClone(next);
    },
    async writeEquipment(equipment: EquipmentRow[], undo: UndoRow[]) {
      state = structuredClone({ ...state, db: { ...state.db, equipment }, undo });
    },
    close() {},
  };
}

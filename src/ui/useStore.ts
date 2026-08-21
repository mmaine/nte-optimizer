/**
 * React's view of the store.
 *
 * `useSyncExternalStore` rather than context plus state, so the store stays a
 * plain object that Node tests can drive without a renderer.
 */
import { createContext, useContext, useSyncExternalStore } from "react";

import type { AppState, Store } from "../state/store.ts";

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("no store in context");
  return store;
}

export function useAppState(): AppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

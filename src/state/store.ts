/**
 * The app store.
 *
 * Deliberately not a library: an observable holding one immutable `StoredState`,
 * plus the adapter it persists through. React subscribes via
 * `useSyncExternalStore`, so nothing here imports React and the whole thing is
 * testable in Node.
 */
import { createBestAdapter } from "../db/adapters/idb.ts";
import { emptyState, type PersistenceAdapter, type StoredState } from "../db/adapters/types.ts";
import { parseGearExport, type ImportResult } from "../db/import.ts";
import {
  applyImport,
  editItem,
  equip,
  nameOwnerGroup,
  persist,
  undoLast,
  type EquipOptions,
  type EquipOutcome,
} from "../db/store.ts";
import { importDatabase, exportDatabase, type DbFile } from "../db/dbfile.ts";

export interface AppState {
  ready: boolean;
  /** False in the degraded persistence tiers, which the UI must announce. */
  durable: boolean;
  adapterKind: PersistenceAdapter["kind"];
  data: StoredState;
  /** The last import that was offered and refused, so the report can be shown. */
  lastImportReport: ImportResult | null;
}

type Listener = () => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(private adapter: PersistenceAdapter) {
    this.state = {
      ready: false,
      durable: adapter.durable,
      adapterKind: adapter.kind,
      data: emptyState(),
      lastImportReport: null,
    };
  }

  static async open(adapter?: PersistenceAdapter): Promise<Store> {
    const store = new Store(adapter ?? (await createBestAdapter()));
    await store.load();
    return store;
  }

  getState = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  async load(): Promise<void> {
    this.set({ data: await this.adapter.read(), ready: true });
  }

  /**
   * Validate an export without applying it.
   *
   * Import is deliberate and irreversible by design, so the confirmation dialog
   * gets the counts first and the player gets to refuse.
   */
  reviewImport(raw: unknown): ImportResult {
    const result = parseGearExport(raw);
    this.set({ lastImportReport: result });
    return result;
  }

  async applyReviewedImport(result: ImportResult): Promise<void> {
    const next = applyImport(this.state.data, result);
    await persist(this.adapter, next, "all");
    this.set({ data: next, lastImportReport: null });
  }

  /** The escape hatch: not undo, but one click back from a wrong file. */
  async restorePreImport(): Promise<boolean> {
    const snapshot = this.state.data.snapshot;
    if (!snapshot) return false;
    const next: StoredState = { db: snapshot, undo: [], snapshot: null };
    await persist(this.adapter, next, "all");
    this.set({ data: next });
    return true;
  }

  async equip(
    characterId: string,
    instances: readonly string[],
    options?: EquipOptions,
  ): Promise<EquipOutcome["displaced"]> {
    const outcome = equip(this.state.data, characterId, instances, options);
    await persist(this.adapter, outcome.state, "equipment");
    this.set({ data: outcome.state });
    return outcome.displaced;
  }

  /** Record what the game's sheet actually reads for a character. */
  async setMeasuredSheet(
    characterId: string,
    measured: Record<string, number> | null,
  ): Promise<void> {
    const characters = this.state.data.db.characters.map((row) =>
      row.characterId === characterId ? { ...row, measuredSheet: measured } : row,
    );
    const next = { ...this.state.data, db: { ...this.state.data.db, characters } };
    await persist(this.adapter, next, "all");
    this.set({ data: next });
  }

  /** Correct a decoded value by hand. Overwritten by the next capture import. */
  async editItem(
    instance: string,
    patch: Parameters<typeof editItem>[2],
  ): Promise<void> {
    const next = editItem(this.state.data, instance, patch);
    await persist(this.adapter, next, "all");
    this.set({ data: next });
  }

  async undo(): Promise<void> {
    const next = undoLast(this.state.data);
    await persist(this.adapter, next, "equipment");
    this.set({ data: next });
  }

  async nameGroup(ownerGroup: string, characterId: string): Promise<void> {
    const next = nameOwnerGroup(this.state.data, ownerGroup, characterId);
    await persist(this.adapter, next, "all");
    this.set({ data: next });
  }

  exportFile(gamedataVersion: string | null): DbFile {
    return exportDatabase(this.state.data, gamedataVersion);
  }

  async importFile(raw: unknown): Promise<string[]> {
    const result = importDatabase(raw);
    if (!result.ok || !result.state) return result.problems;
    // Same protection as a capture import: keep a way back.
    const next: StoredState = { ...result.state, snapshot: this.state.data.db };
    await persist(this.adapter, next, "all");
    this.set({ data: next });
    return [];
  }

  close(): void {
    this.adapter.close();
  }
}

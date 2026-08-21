/**
 * Database export and import - the "backend" without a backend.
 *
 * Deliberately separate from importing a game capture and labelled that way in
 * the UI: a capture is the game telling you what you own, this is your whole
 * workspace including everything you configured by hand. It is backup, moving
 * between machines, sharing a snapshot - and it is the only persistence story
 * the `file://` build has, where IndexedDB does not exist.
 */
import { DB_VERSION } from "./schema.ts";
import { emptyState, type StoredState } from "./adapters/types.ts";

export const DBFILE_FORMAT = "nte-optimizer-db";
export const DBFILE_VERSION = 1;

export interface DbFile {
  format: string;
  format_version: number;
  /** Schema version the rows were written against. */
  schema_version: number;
  /** Which generated game data was in play, so a mismatch can be reported. */
  gamedata_version: string | null;
  exported_at: number;
  state: StoredState;
}

export function exportDatabase(
  state: StoredState,
  gamedataVersion: string | null,
  now = Date.now,
): DbFile {
  return {
    format: DBFILE_FORMAT,
    format_version: DBFILE_VERSION,
    schema_version: DB_VERSION,
    gamedata_version: gamedataVersion,
    exported_at: now(),
    state: structuredClone(state),
  };
}

export function fileName(now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `nte-db-${date}.json`;
}

export interface DbFileImport {
  ok: boolean;
  problems: string[];
  state?: StoredState;
  /** True when the file was written against an older schema. */
  migrated: boolean;
}

/**
 * Read a database file back.
 *
 * A file from a *newer* schema is refused rather than partially understood: the
 * rows may carry fields this build would drop on the next write, and silently
 * discarding the player's configuration is worse than refusing to open it.
 */
export function importDatabase(raw: unknown): DbFileImport {
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, problems: ["not an object"], migrated: false };
  }
  const file = raw as Partial<DbFile>;
  if (file.format !== DBFILE_FORMAT) {
    return { ok: false, problems: [`not a database file: ${String(file.format)}`], migrated: false };
  }
  if (file.format_version !== DBFILE_VERSION) {
    return {
      ok: false,
      problems: [`unsupported file version ${String(file.format_version)}`],
      migrated: false,
    };
  }
  const schema = file.schema_version ?? 0;
  if (schema > DB_VERSION) {
    return {
      ok: false,
      problems: [`written by a newer build (schema ${schema} > ${DB_VERSION})`],
      migrated: false,
    };
  }
  if (typeof file.state !== "object" || file.state === null) {
    return { ok: false, problems: ["no state"], migrated: false };
  }

  const base = emptyState();
  const state = file.state as Partial<StoredState>;
  const merged: StoredState = {
    db: { ...base.db, ...(state.db ?? {}) },
    undo: state.undo ?? [],
    snapshot: state.snapshot ?? null,
  };

  for (const key of ["items", "equipment", "characters", "ownerNames", "meta"] as const) {
    if (!Array.isArray(merged.db[key])) {
      problems.push(`${key} is not a list`);
    }
  }
  if (problems.length > 0) return { ok: false, problems, migrated: false };

  return { ok: true, problems, state: merged, migrated: schema < DB_VERSION };
}

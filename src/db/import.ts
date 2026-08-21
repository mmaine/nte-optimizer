/**
 * Turning a gear export into rows.
 *
 * **Fail closed.** Any error at all and nothing is written: a partially imported
 * account is worse than a refused import, because the player cannot tell which
 * half is stale. The report is diff-shaped on purpose - "817 expected, 811
 * parsed, 6 rejected" tells you something is wrong with the capture; a silent
 * 811 does not.
 *
 * This module is pure. It parses, validates and normalises; it never touches
 * IndexedDB, so it runs in a worker and in a test unchanged.
 */
import { SET_IDS } from "../domain/cartridges.ts";
import { SHAPES } from "../domain/shapes.ts";
import { isKnownStat } from "../domain/statvec.ts";
import {
  emptyCharacter,
  type CharacterRow,
  type EquipmentRow,
  type ItemRow,
} from "./schema.ts";

export const EXPORT_FORMAT = "nte-gear-export";
export const SUPPORTED_FORMAT_VERSION = 1;

export interface ImportProblem {
  code: string;
  detail: string;
  /** The item or character it concerns, when there is one. */
  subject?: string;
}

export interface ImportReport {
  /** How many item records the export claimed, from its own `scan` block. */
  expected: number | null;
  parsed: number;
  rejected: number;
  problems: ImportProblem[];
}

export interface ImportResult {
  ok: boolean;
  report: ImportReport;
  /** Only present when `ok` - there is nothing partial to apply. */
  rows?: {
    items: ItemRow[];
    equipment: EquipmentRow[];
    characters: CharacterRow[];
    userUid: string | null;
    serverId: string | null;
    exporterVersion: string | null;
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function statPairs(
  raw: unknown,
  problems: ImportProblem[],
  subject: string,
  allowNull: boolean,
): Array<{ stat: string; value: number | null }> | null {
  if (!Array.isArray(raw)) {
    problems.push({ code: "stats_not_a_list", detail: "expected a list", subject });
    return null;
  }
  const out: Array<{ stat: string; value: number | null }> = [];
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry["stat"] !== "string") {
      problems.push({ code: "stat_malformed", detail: "missing stat id", subject });
      return null;
    }
    const stat = entry["stat"];
    const value = entry["value"];
    if (!isKnownStat(stat)) {
      // A stat the model has no slot for cannot be scored, so it cannot be
      // silently kept either.
      problems.push({ code: "unknown_stat", detail: stat, subject });
      return null;
    }
    if (value === null || value === undefined) {
      if (!allowNull) {
        problems.push({ code: "substat_without_value", detail: stat, subject });
        return null;
      }
      out.push({ stat, value: null });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push({ code: "stat_value_not_a_number", detail: stat, subject });
      return null;
    }
    out.push({ stat, value });
  }
  return out;
}

export function parseGearExport(raw: unknown): ImportResult {
  const problems: ImportProblem[] = [];
  const fail = (report?: Partial<ImportReport>): ImportResult => ({
    ok: false,
    report: { expected: null, parsed: 0, rejected: 0, problems, ...report },
  });

  if (!isObject(raw)) return fail();
  if (raw["format"] !== EXPORT_FORMAT) {
    problems.push({ code: "wrong_format", detail: String(raw["format"]) });
    return fail();
  }
  if (raw["format_version"] !== SUPPORTED_FORMAT_VERSION) {
    problems.push({
      code: "unsupported_format_version",
      detail: String(raw["format_version"]),
    });
    return fail();
  }

  const scan = isObject(raw["scan"]) ? raw["scan"] : null;
  const expected =
    scan && typeof scan["cartridges"] === "number" && typeof scan["modules"] === "number"
      ? scan["cartridges"] + scan["modules"]
      : null;

  const rawItems = raw["items"];
  if (!Array.isArray(rawItems)) {
    problems.push({ code: "items_missing", detail: "no items list" });
    return fail({ expected });
  }

  const items: ItemRow[] = [];
  const equipment: EquipmentRow[] = [];
  const seen = new Set<string>();
  const at = Date.now();
  const batchId = `import-${at}`;
  let rejected = 0;

  for (const entry of rawItems) {
    if (!isObject(entry)) {
      rejected += 1;
      problems.push({ code: "item_not_an_object", detail: "skipped" });
      continue;
    }
    const instance = entry["instance"];
    const itemId = entry["item_id"];
    const kind = entry["kind"];
    const subject = typeof instance === "string" ? instance : "<no instance>";

    if (typeof instance !== "string" || instance.length === 0) {
      rejected += 1;
      problems.push({ code: "item_without_instance", detail: String(itemId), subject });
      continue;
    }
    if (seen.has(instance)) {
      // The primary key would silently overwrite; say so instead.
      rejected += 1;
      problems.push({ code: "duplicate_instance", detail: instance, subject });
      continue;
    }
    if (kind !== "module" && kind !== "cartridge") {
      rejected += 1;
      problems.push({ code: "unknown_kind", detail: String(kind), subject });
      continue;
    }
    if (typeof itemId !== "string") {
      rejected += 1;
      problems.push({ code: "item_without_id", detail: "missing item_id", subject });
      continue;
    }

    const shape = typeof entry["shape"] === "string" ? entry["shape"] : null;
    if (kind === "module" && (shape === null || !(shape in SHAPES))) {
      rejected += 1;
      problems.push({ code: "unknown_shape", detail: String(shape), subject });
      continue;
    }

    const set =
      kind === "cartridge"
        ? (SET_IDS[itemId] ?? (typeof entry["set"] === "string" ? entry["set"] : null))
        : null;
    if (kind === "cartridge" && set === null) {
      rejected += 1;
      problems.push({ code: "unknown_set", detail: itemId, subject });
      continue;
    }

    const before = problems.length;
    const mains = statPairs(entry["main_stats"], problems, subject, true);
    const subs = statPairs(entry["substats"], problems, subject, false);
    if (mains === null || subs === null || problems.length !== before) {
      rejected += 1;
      continue;
    }

    const level = entry["level"];
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 20) {
      rejected += 1;
      problems.push({ code: "bad_level", detail: String(level), subject });
      continue;
    }

    seen.add(instance);
    items.push({
      instance,
      kind,
      itemId,
      shape,
      cells: shape ? SHAPES[shape as keyof typeof SHAPES].length : null,
      set,
      level,
      rarity: typeof entry["rarity"] === "string" ? entry["rarity"] : "unknown",
      mainStats: mains,
      substats: subs as Array<{ stat: string; value: number }>,
    });

    const ownerGroup = entry["owner_group"];
    if (typeof ownerGroup === "string" && ownerGroup.length > 0) {
      equipment.push({
        instance,
        ownerGroup,
        characterId: null,
        cells: null,
        origin: "imported",
        batchId,
        at,
      });
    }
  }

  const characters: CharacterRow[] = [];
  const rawCharacters = raw["characters"];
  if (Array.isArray(rawCharacters)) {
    for (const entry of rawCharacters) {
      if (!isObject(entry) || typeof entry["key"] !== "string") {
        problems.push({ code: "character_malformed", detail: "missing key" });
        continue;
      }
      const row = emptyCharacter(entry["key"]);
      row.level = typeof entry["level"] === "number" ? entry["level"] : null;
      row.breakthroughs =
        typeof entry["breakthroughs"] === "number" ? entry["breakthroughs"] : null;
      characters.push(row);
    }
  }

  // The count from the export's own scan block is the check that catches a
  // truncated capture, which no per-record validation can see.
  if (expected !== null && items.length + rejected !== expected) {
    problems.push({
      code: "count_mismatch",
      detail: `${expected} expected, ${items.length + rejected} present`,
    });
  }

  const report: ImportReport = {
    expected,
    parsed: items.length,
    rejected,
    problems,
  };

  if (rejected > 0 || problems.length > 0) return { ok: false, report };

  return {
    ok: true,
    report,
    rows: {
      items,
      equipment,
      characters,
      userUid: typeof raw["user_uid"] === "string" ? raw["user_uid"] : null,
      serverId: typeof raw["server_id"] === "string" ? raw["server_id"] : null,
      exporterVersion: isObject(raw["exporter"])
        ? ((raw["exporter"]["version"] as string | undefined) ?? null)
        : null,
    },
  };
}

/**
 * Merge imported character rows onto stored ones.
 *
 * Level and ascension come from the game and are refreshed; everything the
 * player configured - Arc, refinement, effect toggles, build variant, custom
 * targets - is theirs and survives.
 */
export function mergeCharacters(
  stored: readonly CharacterRow[],
  imported: readonly CharacterRow[],
): CharacterRow[] {
  const byId = new Map(stored.map((row) => [row.characterId, row]));
  const out: CharacterRow[] = [];
  for (const row of imported) {
    const previous = byId.get(row.characterId);
    byId.delete(row.characterId);
    out.push(
      previous
        ? { ...previous, level: row.level, breakthroughs: row.breakthroughs }
        : row,
    );
  }
  // A character the capture did not mention is still the player's; keep it.
  for (const remaining of byId.values()) out.push(remaining);
  return out;
}

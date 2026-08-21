/**
 * What an Arc contributes.
 *
 * Two separate things, and they behave differently:
 *
 * 1. Its **own stat line** (`stats`), indexed by the Arc's level 1..80. Every
 *    Arc carries flat `AtkBase` plus one secondary stat.
 * 2. Its **effect placeholders** (`values`), indexed by refinement 1..5. These
 *    are only usable when `data/arc_effects.json` classifies them, because the
 *    game data gives 104 of the 144 placeholders an empty `id_stats` and no way
 *    to tell a stat from a cooldown.
 *
 * The classification decides the control, not a guess about the text:
 * `always` is unconditional, `toggle` is a checkbox, `stacks` is a 0..N count,
 * and `duration` and `unmodellable` are never scored at all - they are reported
 * so the UI can say what it is leaving out rather than silently dropping it.
 */
import type { Arc, ArcEffect, ArcEffectMode, GameData } from "../state/gamedata.ts";
import { emptyVector, slotOf } from "./statvec.ts";

export const MAX_ARC_LEVEL = 80;
export const MAX_REFINEMENT = 5;

export interface ArcConfig {
  arcId: string;
  /** 1..80. */
  level: number;
  /** 1..5. */
  refinement: number;
  /**
   * Per placeholder index: `true`/`false` for a toggle, a count for stacks.
   * Missing means the effect's own default.
   */
  toggles?: Record<number, boolean | number>;
}

export interface ArcContribution {
  vector: Float32Array;
  /** Effects deliberately not scored, so the UI can say so. */
  omitted: Array<{ placeholder: number; mode: ArcEffectMode; why: string }>;
  /** Stats the model has no slot for. Should stay empty; a warning if not. */
  unknownStats: string[];
}

interface RawStatCurve {
  id_stats: string;
  bIsPercent: boolean;
  values: number[];
}

interface RawValue {
  id_value: number;
  id_stats: string;
  bIsPercent: boolean;
  values: Array<string | number>;
}

/** `"12%"` is 0.12; a bare number is itself. */
export function parseArcValue(raw: string | number, percent: boolean): number {
  if (typeof raw === "number") return percent ? raw / 100 : raw;
  const trimmed = raw.trim();
  const numeric = Number.parseFloat(trimmed.replace("%", ""));
  if (!Number.isFinite(numeric)) return 0;
  return trimmed.endsWith("%") || percent ? numeric / 100 : numeric;
}

export function arcContribution(
  arc: Arc,
  effects: GameData["arcEffects"][string] | undefined,
  config: ArcConfig,
): ArcContribution {
  const vector = emptyVector();
  const omitted: ArcContribution["omitted"] = [];
  const unknownStats: string[] = [];

  const level = Math.min(Math.max(Math.round(config.level), 1), MAX_ARC_LEVEL);
  const refinement = Math.min(Math.max(Math.round(config.refinement), 1), MAX_REFINEMENT);

  const add = (stat: string, value: number): void => {
    const slot = slotOf(stat);
    if (slot < 0) {
      if (stat && !unknownStats.includes(stat)) unknownStats.push(stat);
      return;
    }
    vector[slot] = vector[slot]! + value;
  };

  for (const curve of (arc.stats ?? []) as RawStatCurve[]) {
    const raw = curve.values?.[level - 1];
    if (raw === undefined) continue;
    add(curve.id_stats, curve.bIsPercent ? raw / 100 : raw);
  }

  const byPlaceholder = new Map<number, ArcEffect>(
    (effects?.effects ?? []).map((effect) => [effect.placeholder, effect]),
  );

  for (const entry of (arc.values ?? []) as RawValue[]) {
    const effect = byPlaceholder.get(entry.id_value);
    const mode: ArcEffectMode = effect?.mode ?? "unmodellable";
    const raw = entry.values?.[refinement - 1];

    if (mode === "duration" || mode === "unmodellable" || !entry.id_stats || raw === undefined) {
      omitted.push({
        placeholder: entry.id_value,
        mode,
        why: effect?.why ?? "no stat id in the game data",
      });
      continue;
    }

    const value = parseArcValue(raw, entry.bIsPercent);
    const setting = config.toggles?.[entry.id_value];

    if (mode === "always") {
      add(entry.id_stats, value);
      continue;
    }
    if (mode === "toggle") {
      const on = typeof setting === "boolean" ? setting : (effect?.default ?? false);
      if (on) add(entry.id_stats, value);
      else omitted.push({ placeholder: entry.id_value, mode, why: "toggled off" });
      continue;
    }
    // stacks
    const count = typeof setting === "number" ? Math.max(0, Math.round(setting)) : 0;
    if (count > 0) add(entry.id_stats, value * count);
    else omitted.push({ placeholder: entry.id_value, mode, why: "no stacks assumed" });
  }

  return { vector, omitted, unknownStats };
}

/** The controls a UI needs for one Arc, in placeholder order. */
export function arcControls(
  arc: Arc,
  effects: GameData["arcEffects"][string] | undefined,
): Array<{ placeholder: number; mode: ArcEffectMode; stat: string; why: string }> {
  const byPlaceholder = new Map<number, ArcEffect>(
    (effects?.effects ?? []).map((effect) => [effect.placeholder, effect]),
  );
  return ((arc.values ?? []) as RawValue[])
    .map((entry) => {
      const effect = byPlaceholder.get(entry.id_value);
      return {
        placeholder: entry.id_value,
        mode: effect?.mode ?? ("unmodellable" as ArcEffectMode),
        stat: entry.id_stats,
        why: effect?.why ?? "",
      };
    })
    .filter((control) => control.mode === "toggle" || control.mode === "stacks");
}

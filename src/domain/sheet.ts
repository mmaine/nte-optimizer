/**
 * The predicted character sheet.
 *
 * This exists to be **checked against the game**, not trusted. The stat model
 * has measured gaps - the base-stat multiplier has never been read at level 80,
 * which is the level builds actually use - so every value here is either derived
 * from something measured or reported as unavailable. Nothing is estimated to
 * fill a hole.
 *
 * Read sheets with the character OFF the active team. On field an Arc's
 * conditional effects are folded into the displayed numbers with no way to
 * separate them from gear.
 */
import {
  BASE_CHARGE_EFFICIENCY,
  BASE_CRIT_DAMAGE,
  BASE_CRIT_RATE,
  BASE_CYCLE_INTENSITY,
  baseStat,
  hasMultiplier,
} from "./stats.ts";
import { slotOf } from "./statvec.ts";

export interface SheetLine {
  key: string;
  label: string;
  /** Null when the model cannot produce a number honestly. */
  predicted: number | null;
  /** Why it is null, when it is. */
  unavailable?: string;
  percent: boolean;
}

export interface EsperCurves {
  stats: Array<{ id_stats: string; values: number[] }>;
}

const curve = (esper: EsperCurves, id: string): number[] | null =>
  esper.stats.find((entry) => entry.id_stats === id)?.values ?? null;

/**
 * `total` is the character's whole stat vector: base contributions (Arc
 * included) plus every equipped piece.
 */
export function predictSheet(
  esper: EsperCurves,
  level: number | null,
  total: Float32Array,
): SheetLine[] {
  const get = (stat: string): number => {
    const slot = slotOf(stat);
    return slot < 0 ? 0 : (total[slot] ?? 0);
  };

  const scaled = (
    key: string,
    label: string,
    curveId: string,
    which: "HP" | "ATK" | "DEF",
    percentStat: string,
    flatStat: string,
    extraBase = 0,
  ): SheetLine => {
    const values = curve(esper, curveId);
    if (level === null) {
      return { key, label, predicted: null, unavailable: "character level unknown", percent: false };
    }
    if (!hasMultiplier(level)) {
      // Level 80 is the level builds actually use and has never been measured.
      // One gearless, off-team reading of any character at 80 fills it in for
      // everyone - so this says what is missing rather than guessing.
      return {
        key,
        label,
        predicted: null,
        unavailable: `base multiplier not measured at level ${level}`,
        percent: false,
      };
    }
    const base = values ? baseStat(values, level, which) : null;
    if (base === null) {
      return { key, label, predicted: null, unavailable: "no stat curve", percent: false };
    }
    return {
      key,
      label,
      predicted: (base + extraBase) * (1 + get(percentStat)) + get(flatStat),
      percent: false,
    };
  };

  return [
    scaled("hp", "HP", "HPMaxBase", "HP", "HPMaxUp", "HPMaxAdd"),
    // The Arc's flat ATK scales with ATK%; gear's flat ATK does not, which is
    // why they sit in different slots and enter here differently.
    scaled("atk", "ATK", "AtkBase", "ATK", "AtkUp", "AtkAdd", get("AtkBase")),
    scaled("def", "DEF", "DefBase", "DEF", "DefUp", "DefAdd"),
    {
      key: "crit",
      label: "CRIT Rate",
      predicted: BASE_CRIT_RATE + get("CritBase"),
      percent: true,
    },
    {
      key: "critDamage",
      label: "CRIT DMG",
      predicted: BASE_CRIT_DAMAGE + get("CritDamageBase"),
      percent: true,
    },
    {
      key: "cycle",
      label: "Cycle Intensity",
      predicted: BASE_CYCLE_INTENSITY + get("UnbalIntensityBase") + get("UnbalIntensity"),
      percent: false,
    },
    {
      key: "charge",
      label: "Charge Efficiency",
      predicted: BASE_CHARGE_EFFICIENCY + get("ChargeGetEfficiencyBase"),
      percent: true,
    },
    {
      key: "break",
      label: "Break",
      // `MagBase` is believed to be the Break stat, but that mapping has never
      // been confirmed against a sheet, so it is shown for comparison rather
      // than presented as settled.
      predicted: get("MagBase") + get("Mag"),
      percent: false,
    },
  ];
}

export interface SheetComparison extends SheetLine {
  actual: number | null;
  /** predicted - actual, when both exist. */
  delta: number | null;
  /** True when the gap is larger than rounding can explain. */
  drifted: boolean;
}

/** Anything past this is a model error, not display rounding. */
export const DRIFT_TOLERANCE = 1;

export function compareSheet(
  lines: readonly SheetLine[],
  measured: Record<string, number> | null | undefined,
): SheetComparison[] {
  return lines.map((line) => {
    const actual = measured?.[line.key] ?? null;
    const delta =
      line.predicted !== null && actual !== null ? line.predicted - actual : null;
    return {
      ...line,
      actual,
      delta,
      // Percentages are compared on their own scale, not against a flat 1.
      drifted:
        delta !== null && Math.abs(delta) > (line.percent ? 0.005 : DRIFT_TOLERANCE),
    };
  });
}

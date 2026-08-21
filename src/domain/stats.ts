/**
 * The stat model, ported from `stats.py`.
 *
 * Two rules govern everything here, and both were expensive to learn:
 *
 * 1. **Sheets must be read with the character OFF the active team.** On field an
 *    Arc's conditional effects are folded into the displayed numbers with no way
 *    to separate them from gear. Zankou reads 75% / 203.20% on field and
 *    59% / 200.00% off it.
 * 2. **One character cannot separate a flat bonus from a multiplicative one.**
 *    An earlier model fitted a flat base-stat bonus to Zankou alone and was
 *    simply wrong; a second character falsified it outright. Never confirm a
 *    model shape against a single reading.
 */
import type { ShapeId } from "./shapes.ts";

export const BASE_CRIT_RATE = 0.05;
export const BASE_CRIT_DAMAGE = 0.5;
export const BASE_CYCLE_INTENSITY = 100;
export const BASE_CHARGE_EFFICIENCY = 1;

/** A measured value, or the band a rounded curve leaves it in. */
export type Measured = number | { readonly min: number; readonly max: number };

export const midpoint = (value: Measured): number =>
  typeof value === "number" ? value : (value.min + value.max) / 2;

/**
 * base(stat) = floor(curve[level - 1] * M(level, stat))
 *
 * M does not depend on the character: Haniel and Adler both give 1.48777 at
 * level 50 to five decimals while their flat deltas differ, so one table indexed
 * by level covers all 23 espers.
 *
 * HP and DEF track together; ATK runs lower, and at level 50 the bands do not
 * overlap (~1.4878 vs ~1.4380), so the split is real rather than rounding.
 */
export const MULTIPLIER: Record<number, Record<"HP" | "ATK" | "DEF", Measured>> = {
  // The level-50 HP figure is a band, not the five-decimal 1.48777 the Python
  // records: that value floors Adler to 8637 against a measured 8638. Two
  // readings pin it to [8638/5806, 8273/5560), and the midpoint reproduces both.
  50: {
    HP: { min: 1.4877713, max: 1.4879435 },
    ATK: { min: 1.43684, max: 1.43925 },
    DEF: { min: 1.48883, max: 1.49128 },
  },
  70: { HP: 1.61347, ATK: 1.56369, DEF: 1.6135 },
};

/**
 * Level 80 is the level builds actually use and it has never been measured. One
 * gearless, off-team reading of any character at 80 fills it in for everyone.
 */
export const UNMEASURED_LEVELS = [80];

export function hasMultiplier(level: number): boolean {
  return level in MULTIPLIER;
}

export function baseStat(
  curve: readonly number[],
  level: number,
  stat: "HP" | "ATK" | "DEF",
): number | null {
  const row = MULTIPLIER[level];
  const value = curve[level - 1];
  if (!row || value === undefined) return null;
  return Math.floor(value * midpoint(row[stat]));
}

/**
 * total ATK = (base + arc) * (1 + atkPercent) + flat
 *
 * The Arc's ATK scales with ATK%; flat gear ATK does not. A rival fit of
 * `base * (1 + pct) + arc + flat` also lands on the sheet exactly - the sheet
 * truncates, so an exact hit is no stronger evidence than a truncated one, and
 * only a fully unequipped reading can settle it.
 */
export function totalAtk(base: number, arc: number, flat: number, atkPercent: number): number {
  return (base + arc) * (1 + atkPercent) + flat;
}

export interface TraitStat {
  id_stats: string;
  name: string;
  bShowPercent: boolean;
  value: number;
}

export interface ConsoleTrait {
  /** Raw stat id, e.g. `CritDamageBase`. */
  stat: string;
  name: string;
  /** Per qualifying module: already divided by 100 when the stat is a percent. */
  per: number;
  /**
   * The module *cell count* the trait counts - 2 or 3. This is everness's
   * `OwnerGridCount`, which is NOT the grid type despite the name; Prydwen's
   * "Console Grid Type" means this same number.
   */
  moduleCells: number;
}

export interface EsperTraitSource {
  trait: readonly TraitStat[];
  ownerGridCount: number;
}

/**
 * Read the trait from the data, never from a table.
 *
 * It is not always Type III and not always CRIT DMG: three characters key on
 * Type II, and the values run 6 to 16 across eight different stats.
 */
export function consoleTrait(esper: EsperTraitSource): ConsoleTrait | null {
  const stat = esper.trait[0];
  if (!stat) return null;
  return {
    stat: stat.id_stats,
    name: stat.name,
    per: stat.bShowPercent ? stat.value / 100 : stat.value,
    moduleCells: esper.ownerGridCount,
  };
}

/** What the console trait contributes for a given set of modules on the board. */
export function traitContribution(
  trait: ConsoleTrait | null,
  shapes: readonly ShapeId[],
): { stat: string; value: number } | null {
  if (!trait) return null;
  let qualifying = 0;
  for (const shape of shapes) {
    if (Number(shape.slice(4, 5)) === trait.moduleCells) qualifying += 1;
  }
  return { stat: trait.stat, value: trait.per * qualifying };
}

/**
 * Ravenous Blade's +16% CRIT Rate needs the Arc equipped AND the character on
 * field, isolated by three readings: arc off / on field 35%, arc on / off field
 * 59%, arc on / on field 75%.
 */
export const ARC_ON_FIELD_EFFECTS: Record<string, Record<string, number>> = {
  "Ravenous Blade": { CritBase: 0.16 },
};

/**
 * +3.2% CRIT DMG appears in both on-field readings, with and without the Arc, so
 * it is neither gear nor the Arc. Source unidentified; harmless as long as
 * sheets are read off-team, which is why the app never models on-field numbers.
 */
export const ON_FIELD_UNKNOWN: Record<string, number> = { CritDamageBase: 0.032 };

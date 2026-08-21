/**
 * The objective.
 *
 * Targets are Prydwen's recommended endgame stats - a floor to reach, not a
 * ceiling - so each stat's attainment saturates at `min(value / target, 1)` and
 * the score is the weighted mean of those attainments. Weights come from the
 * character's published substat ranking, so where the targets cannot all be met
 * the shortfall lands on the lowest-ranked stats by construction.
 *
 * Saturation has a consequence worth stating plainly: **once every target is
 * cleared, every build ties at 1.0** and the winner is decided entirely by the
 * tie-breakers below. Both are therefore per-stat, configurable and rendered -
 * never a hidden constant.
 *
 * There is no damage model here. Without rotation or ability-multiplier data,
 * anything claiming to maximise DPS would be inventing numbers.
 */
import { SLOT_COUNT, STAT_SLOTS, slotOf, type StatId } from "./statvec.ts";

export interface StatTarget {
  stat: StatId;
  /** The floor to reach. A target of 0 means "no target": weight is ignored. */
  target: number;
  /** Relative importance, from the substat ranking. Any positive scale. */
  weight: number;
  /**
   * Credit for exceeding the target, as a fraction of this stat's own weight.
   * 0 disables it; the default is small on purpose, so overshoot breaks ties
   * rather than competing with reaching a target at all.
   */
  overshoot?: number;
}

export interface ScoringConfig {
  targets: StatTarget[];
  /**
   * How far past a target overshoot keeps paying, as a multiple of the target.
   * 1 means credit runs out at double the target.
   */
  overshootCap?: number;
  /**
   * The cartridge main-stat ranking is only a tiebreak - substats dominate - so
   * it enters as an explicit epsilon rather than as a weight. Without a term
   * like this the rule is not implementable at all.
   */
  mainStatEpsilon?: number;
  /** Published main-stat preference, 1 best down to 0. */
  mainStatRank?: Partial<Record<StatId, number>>;
}

export interface CompiledScoring {
  targets: Float32Array;
  weights: Float32Array;
  overshoot: Float32Array;
  overshootCap: number;
  mainStatEpsilon: number;
  mainStatRank: Float32Array;
  /** Sum of weights, so the score lands in 0..1 before tie-breakers. */
  weightSum: number;
}

export const DEFAULT_OVERSHOOT = 0.1;
export const DEFAULT_OVERSHOOT_CAP = 1;
export const DEFAULT_MAIN_STAT_EPSILON = 0.001;

export function compile(config: ScoringConfig): CompiledScoring {
  const targets = new Float32Array(SLOT_COUNT);
  const weights = new Float32Array(SLOT_COUNT);
  const overshoot = new Float32Array(SLOT_COUNT);
  const mainStatRank = new Float32Array(SLOT_COUNT);
  let weightSum = 0;

  for (const entry of config.targets) {
    const slot = slotOf(entry.stat);
    if (slot < 0) throw new Error(`no stat slot for ${entry.stat}`);
    if (entry.target <= 0 || entry.weight <= 0) continue;
    targets[slot] = entry.target;
    weights[slot] = entry.weight;
    overshoot[slot] = entry.overshoot ?? DEFAULT_OVERSHOOT;
    weightSum += entry.weight;
  }
  for (const [stat, rank] of Object.entries(config.mainStatRank ?? {})) {
    const slot = slotOf(stat);
    if (slot >= 0 && rank !== undefined) mainStatRank[slot] = rank;
  }

  return {
    targets,
    weights,
    overshoot,
    overshootCap: config.overshootCap ?? DEFAULT_OVERSHOOT_CAP,
    mainStatEpsilon: config.mainStatEpsilon ?? DEFAULT_MAIN_STAT_EPSILON,
    mainStatRank,
    weightSum,
  };
}

/**
 * The hot path: one pass over the vector, no allocation.
 *
 * `mainStat` is the cartridge's main stat slot, or -1. It contributes only
 * epsilon - substats decide the build, the main-stat ranking breaks the tie.
 */
export function score(
  vector: Float32Array,
  compiled: CompiledScoring,
  mainStat = -1,
): number {
  if (compiled.weightSum === 0) return 0;
  let total = 0;
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const weight = compiled.weights[i]!;
    if (weight === 0) continue;
    const ratio = vector[i]! / compiled.targets[i]!;
    if (ratio >= 1) {
      const excess = Math.min(ratio - 1, compiled.overshootCap);
      total += weight * (1 + compiled.overshoot[i]! * excess);
    } else {
      total += weight * ratio;
    }
  }
  let value = total / compiled.weightSum;
  if (mainStat >= 0) value += compiled.mainStatEpsilon * compiled.mainStatRank[mainStat]!;
  return value;
}

/**
 * An admissible upper bound for branch and bound.
 *
 * Every stat's attainment is monotone nondecreasing and concave in its value, so
 * assuming each remaining slot takes the largest amount still available per stat
 * can only overestimate. If the search closes against this bound the answer is a
 * proof of optimality - and when it does not, the UI has to say so.
 */
export function upperBound(
  partial: Float32Array,
  bestRemaining: Float32Array,
  compiled: CompiledScoring,
): number {
  if (compiled.weightSum === 0) return 0;
  let total = 0;
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const weight = compiled.weights[i]!;
    if (weight === 0) continue;
    const ratio = (partial[i]! + bestRemaining[i]!) / compiled.targets[i]!;
    if (ratio >= 1) {
      const excess = Math.min(ratio - 1, compiled.overshootCap);
      total += weight * (1 + compiled.overshoot[i]! * excess);
    } else {
      total += weight * ratio;
    }
  }
  return total / compiled.weightSum + compiled.mainStatEpsilon;
}

export interface StatBreakdown {
  stat: StatId;
  value: number;
  target: number;
  weight: number;
  /** min(value / target, 1) - what the bars render. */
  attainment: number;
  /** How far past the target, as a fraction of it. 0 when short. */
  overshoot: number;
  /** This stat's share of the total, tie-breakers excluded. */
  contribution: number;
}

export interface ScoreReport {
  total: number;
  /** The score with every overshoot and epsilon term removed. */
  base: number;
  /** True when every weighted target is met. */
  complete: boolean;
  stats: StatBreakdown[];
}

/**
 * The same arithmetic, itemised. The result view renders this rather than a bare
 * number, because a saturating objective is only trustworthy if the player can
 * see which stats are carrying it.
 */
export function explain(
  vector: Float32Array,
  compiled: CompiledScoring,
  mainStat = -1,
): ScoreReport {
  const stats: StatBreakdown[] = [];
  let base = 0;
  let complete = true;

  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const weight = compiled.weights[i]!;
    if (weight === 0) continue;
    const target = compiled.targets[i]!;
    const value = vector[i]!;
    const ratio = value / target;
    const attainment = Math.min(ratio, 1);
    const overshoot = ratio > 1 ? Math.min(ratio - 1, compiled.overshootCap) : 0;
    if (attainment < 1) complete = false;
    base += weight * attainment;
    stats.push({
      stat: STAT_SLOTS[i]!,
      value,
      target,
      weight,
      attainment,
      overshoot,
      contribution: (weight * attainment) / compiled.weightSum,
    });
  }

  stats.sort((a, b) => b.weight - a.weight || a.stat.localeCompare(b.stat));
  return {
    total: score(vector, compiled, mainStat),
    base: compiled.weightSum === 0 ? 0 : base / compiled.weightSum,
    complete,
    stats,
  };
}

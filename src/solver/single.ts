/**
 * One character, one pool.
 *
 * Shape and structure of the search:
 *
 * - **Tiling is a table lookup, never a search.** Positions do not affect score,
 *   so `tools/precompute-tilings.ts` already solved the packing offline and each
 *   entry is a distinct shape multiset.
 * - **Subsets are unordered.** Modules of the same shape are interchangeable, so
 *   choosing 2 of 20 is 190 options and not 380; a beam that permutes identical
 *   assignments spends its whole width on duplicates.
 * - **Modules are solved per packing, not per (packing, cartridge) pair.** The
 *   first version beamed inside that product and needed hundreds of millions of
 *   vector operations for one character. A cartridge shifts one main stat and
 *   four substats, so the beam runs once per packing against the character's
 *   fixed contribution, keeps its best `carry` module sets, and the cartridges
 *   are then scored against those. That turns a product into a sum.
 * - **Beam first, then prove it - once.** Branch and bound runs on the single
 *   winning (packing, cartridge) pair, seeded with the beam's answer. Packings
 *   and cartridge buckets are both enumerated exhaustively, so the only
 *   approximation left anywhere is the module beam inside a packing - and for
 *   the winner even that is closed. `proven` therefore means "no better module
 *   assignment exists for this packing and cartridge", which is a narrower claim
 *   than global optimality and is worded that way on purpose.
 *
 * The whole thing is a generator that yields every few thousand nodes. That is
 * not a nicety: it is the only cancellation mechanism that also works in the
 * `file://` build, where there are no workers at all, and it gives real progress
 * for free.
 */
import type { ConsoleTrait } from "../domain/stats.ts";
import type { ItemPool } from "../domain/items.ts";
import type { SetBonusTable } from "../domain/setbonus.ts";
import type { Tiling } from "../domain/tilings.ts";
import { setBonus } from "../domain/setbonus.ts";
import { traitContribution } from "../domain/stats.ts";
import { score, upperBound, type CompiledScoring } from "../domain/scoring.ts";
import { SLOT_COUNT, addPoolInto, emptyVector, slotOf, vectorFrom } from "../domain/statvec.ts";
import type { Build, SolveProgress, SolveResult } from "./protocol.ts";

export interface SingleRequest {
  pool: ItemPool;
  /** Packings available to this character, already filtered to its board. */
  tilings: readonly Tiling[];
  /** Everything the character brings before gear: base stats, Arc, and so on. */
  base: Float32Array;
  trait: ConsoleTrait | null;
  setBonuses: SetBonusTable;
  scoring: CompiledScoring;
  /** Pool indices held by other characters and therefore off limits. */
  excluded?: ReadonlySet<number>;
  beamWidth?: number;
  /** Candidates kept per shape before subsets are formed. */
  candidateWidth?: number;
  /** Module sets carried out of each packing's beam into the cartridge pass. */
  carry?: number;
  /** Builds kept for the team phase's portfolio. */
  portfolioSize?: number;
  /**
   * Builds kept **per packing**.
   *
   * A global top-N cut is useless to the team phase: the top 300 builds of one
   * character are 300 minor variations on the same modules, so no disjoint team
   * selection exists at all. Keeping a few per packing spans the search instead.
   */
  perTilingKeep?: number;
  /** Nodes before branch and bound gives up and the beam answer stands. */
  nodeBudget?: number;
  /** Nodes between yields. */
  chunkNodes?: number;
}

export const DEFAULT_BEAM_WIDTH = 200;
export const DEFAULT_CANDIDATE_WIDTH = 20;
export const DEFAULT_CARRY = 12;
export const DEFAULT_PORTFOLIO_SIZE = 3000;
export const DEFAULT_PER_TILING_KEEP = 6;
export const DEFAULT_NODE_BUDGET = 300_000;
export const DEFAULT_CHUNK_NODES = 20_000;

interface BeamState {
  vector: Float32Array;
  modules: number[];
  value: number;
}

/** Rank a module by how much of the targets it covers, ignoring saturation. */
function density(pool: ItemPool, index: number, scoring: CompiledScoring): number {
  const base = index * SLOT_COUNT;
  let total = 0;
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const weight = scoring.weights[i]!;
    if (weight === 0) continue;
    total += (weight * pool.vectors[base + i]!) / scoring.targets[i]!;
  }
  return total;
}

/**
 * Every unordered k-subset of `items`.
 *
 * The same array is reused between yields; callers must copy what they keep.
 */
function* subsets(items: readonly number[], k: number): Generator<number[]> {
  const chosen: number[] = [];
  const walk = function* (start: number): Generator<number[]> {
    if (chosen.length === k) {
      yield chosen;
      return;
    }
    // Stop once too few candidates remain to finish the subset.
    for (let i = start; i <= items.length - (k - chosen.length); i += 1) {
      chosen.push(items[i]!);
      yield* walk(i + 1);
      chosen.pop();
    }
  };
  yield* walk(0);
}

/** Distinct shapes in a packing, with how many copies each needs. */
function shapeGroups(tiling: Tiling): Array<{ shape: string; count: number }> {
  const counts = new Map<string, number>();
  for (const shape of tiling.pieces) counts.set(shape, (counts.get(shape) ?? 0) + 1);
  return [...counts].map(([shape, count]) => ({ shape, count }));
}

/**
 * Cartridges whose contribution is identical are interchangeable, so only one of
 * each needs solving. With 55 owned cartridges of a set this removes most of the
 * work before any search starts.
 */
function bucketCartridges(pool: ItemPool, indices: readonly number[]): number[] {
  const seen = new Map<string, number>();
  for (const index of indices) {
    const base = index * SLOT_COUNT;
    const key = `${pool.items[index]!.mainStat}|${Array.from(
      pool.vectors.subarray(base, base + SLOT_COUNT),
    ).join(",")}`;
    if (!seen.has(key)) seen.set(key, index);
  }
  return [...seen.values()];
}

export function* solveSingle(
  request: SingleRequest,
): Generator<SolveProgress, SolveResult, void> {
  const {
    pool,
    tilings,
    base,
    trait,
    setBonuses,
    scoring,
    excluded = new Set<number>(),
    beamWidth = DEFAULT_BEAM_WIDTH,
    candidateWidth = DEFAULT_CANDIDATE_WIDTH,
    carry = DEFAULT_CARRY,
    portfolioSize = DEFAULT_PORTFOLIO_SIZE,
    perTilingKeep = DEFAULT_PER_TILING_KEEP,
    nodeBudget = DEFAULT_NODE_BUDGET,
    chunkNodes = DEFAULT_CHUNK_NODES,
  } = request;

  // Candidates per shape, best first, truncated once.
  const candidates = new Map<string, number[]>();
  for (const [shape, indices] of pool.modulesByShape) {
    const usable = indices.filter((index) => !excluded.has(index));
    usable.sort((a, b) => density(pool, b, scoring) - density(pool, a, scoring));
    candidates.set(shape, usable.slice(0, candidateWidth));
  }

  const cartridgesFor = new Map<string, number[]>();
  for (const tiling of tilings) {
    if (cartridgesFor.has(tiling.set)) continue;
    const owned = (pool.cartridgesBySet.get(tiling.set) ?? []).filter(
      (index) => !excluded.has(index),
    );
    cartridgesFor.set(tiling.set, bucketCartridges(pool, owned));
  }

  const usable = tilings.filter((tiling) => (cartridgesFor.get(tiling.set) ?? []).length > 0);
  const portfolio: Build[] = [];
  let best: Build | null = null;
  let examined = 0;
  let nodes = 0;

  for (const tiling of usable) {
    const groups = shapeGroups(tiling);
    const cartridges = cartridgesFor.get(tiling.set)!;

    // Enough of every shape must exist, or this packing is simply unavailable.
    if (groups.some((group) => (candidates.get(group.shape) ?? []).length < group.count)) {
      examined += 1;
      continue;
    }

    // Fixed part: character base, console trait, set bonus. Not the cartridge -
    // that is folded in afterwards, which is what keeps this a sum.
    const fixed = emptyVector();
    fixed.set(base);
    const traitStat = traitContribution(trait, tiling.pieces);
    if (traitStat) vectorFrom([traitStat], fixed);
    const bonus = setBonus(setBonuses, tiling.set, tiling.pieces);
    for (let i = 0; i < SLOT_COUNT; i += 1) fixed[i] = fixed[i]! + bonus.vector[i]!;

    // Hardest groups first: fewer choices near the root prunes the most.
    const ordered = [...groups].sort(
      (a, b) =>
        candidates.get(a.shape)!.length - a.count - (candidates.get(b.shape)!.length - b.count),
    );

    // --- beam over modules, cartridge-free -------------------------------
    let beam: BeamState[] = [{ vector: fixed, modules: [], value: 0 }];
    for (const group of ordered) {
      const available = candidates.get(group.shape)!;
      const next: BeamState[] = [];
      for (const state of beam) {
        // An item belongs to exactly one shape, so groups are disjoint and no
        // overlap check is needed here.
        for (const pick of subsets(available, group.count)) {
          const vector = new Float32Array(state.vector);
          for (const index of pick) addPoolInto(vector, pool.vectors, index);
          next.push({
            vector,
            modules: [...state.modules, ...pick],
            value: score(vector, scoring),
          });
          nodes += 1;
        }
      }
      if (next.length === 0) {
        beam = [];
        break;
      }
      next.sort((a, b) => b.value - a.value);
      next.length = Math.min(next.length, beamWidth);
      beam = next;
      if (nodes >= chunkNodes) {
        nodes = 0;
        yield { done: examined, total: usable.length, best };
      }
    }

    examined += 1;
    if (beam.length === 0) continue;
    const kept = beam.slice(0, carry);

    // --- fold in each cartridge ------------------------------------------
    // One build per *distinct module set*, keeping that set's best cartridge.
    //
    // Taking the top-N builds instead would return N copies of the same modules
    // with different cartridges, which is no use to the team phase: it needs
    // builds that differ in the items they occupy, not in their trim.
    const forThisTiling: Build[] = [];
    for (const state of kept) {
      let bestForState: Build | null = null;
      for (const cartridge of cartridges) {
        const mainStat = pool.items[cartridge]!.mainStat;
        const mainSlot = mainStat === null ? -1 : slotOf(mainStat);
        const vector = new Float32Array(state.vector);
        addPoolInto(vector, pool.vectors, cartridge);
        const value = score(vector, scoring, mainSlot);
        if (bestForState !== null && value <= bestForState.score) continue;
        bestForState = {
          cartridge,
          modules: state.modules,
          tiling,
          score: value,
          vector,
          proven: false,
          unknownTiers: bonus.unknownTiers,
        };
      }
      if (bestForState === null) continue;
      if (best === null || bestForState.score > best.score) best = bestForState;
      forThisTiling.push(bestForState);
    }
    forThisTiling.sort((a, b) => b.score - a.score);
    portfolio.push(...forThisTiling.slice(0, perTilingKeep));

    yield { done: examined, total: usable.length, best };
  }

  // --- prove the winner, once -------------------------------------------
  if (best !== null) {
    const winner = best;
    const groups = shapeGroups(winner.tiling);
    const fixed = new Float32Array(winner.vector);
    for (const index of winner.modules) {
      const from = index * SLOT_COUNT;
      for (let i = 0; i < SLOT_COUNT; i += 1) fixed[i] = fixed[i]! - pool.vectors[from + i]!;
    }
    const mainStat = pool.items[winner.cartridge]!.mainStat;
    winner.proven = yield* prove(
      pool,
      groups,
      candidates,
      fixed,
      scoring,
      mainStat === null ? -1 : slotOf(mainStat),
      winner,
      nodeBudget,
      chunkNodes,
      () => ({ done: examined, total: usable.length, best }),
    );
  }

  portfolio.sort((a, b) => b.score - a.score);
  portfolio.length = Math.min(portfolio.length, portfolioSize);
  return { best, portfolio, examined, unbuildable: usable.length === 0 };
}

/**
 * Branch and bound over one packing's groups, improving `incumbent` in place.
 *
 * Returns true only if the whole tree was closed within budget - that is the
 * difference between "this is the best build" and "this is the best we found".
 */
function* prove(
  pool: ItemPool,
  groups: ReadonlyArray<{ shape: string; count: number }>,
  candidates: ReadonlyMap<string, number[]>,
  fixed: Float32Array,
  scoring: CompiledScoring,
  mainSlot: number,
  incumbent: Build,
  nodeBudget: number,
  chunkNodes: number,
  progress: () => SolveProgress,
): Generator<SolveProgress, boolean, void> {
  const lists = groups.map((group) => ({
    ...group,
    available: candidates.get(group.shape) ?? [],
  }));
  if (lists.some((group) => group.available.length < group.count)) return false;

  // Per-stat best still reachable from group `i` onward, for the bound.
  const suffixBest: Float32Array[] = new Array(lists.length + 1);
  suffixBest[lists.length] = new Float32Array(SLOT_COUNT);
  for (let g = lists.length - 1; g >= 0; g -= 1) {
    const vector = new Float32Array(suffixBest[g + 1]!);
    const group = lists[g]!;
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      if (scoring.weights[slot] === 0) continue;
      const values = group.available
        .map((index) => pool.vectors[index * SLOT_COUNT + slot]!)
        .sort((a, b) => b - a)
        .slice(0, group.count);
      let sum = 0;
      for (const value of values) sum += value;
      vector[slot] = vector[slot]! + sum;
    }
    suffixBest[g] = vector;
  }

  let nodes = 0;
  let exhausted = false;

  const walk = function* (
    depth: number,
    vector: Float32Array,
    used: number[],
  ): Generator<SolveProgress, void, void> {
    if (exhausted) return;
    if (depth === lists.length) {
      const value = score(vector, scoring, mainSlot);
      if (value > incumbent.score) {
        incumbent.score = value;
        incumbent.modules = [...used];
        incumbent.vector = new Float32Array(vector);
      }
      return;
    }
    if (upperBound(vector, suffixBest[depth]!, scoring) <= incumbent.score) return;

    const group = lists[depth]!;
    for (const pick of subsets(group.available, group.count)) {
      if (exhausted) return;
      nodes += 1;
      if (nodes >= nodeBudget) {
        exhausted = true;
        return;
      }
      if (nodes % chunkNodes === 0) yield progress();

      const child = new Float32Array(vector);
      for (const index of pick) addPoolInto(child, pool.vectors, index);
      const depthUsed = pick.length;
      used.push(...pick);
      yield* walk(depth + 1, child, used);
      used.length -= depthUsed;
    }
  };

  yield* walk(0, fixed, []);
  return !exhausted;
}

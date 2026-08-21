/**
 * Phases 1 and 2 of the team solve: leximin over portfolios, then column
 * generation.
 *
 * **Leximin, not sum.** Maximising the total lets one character eat the pool and
 * leaves another with scraps. Leximin maximises the worst score, then the second
 * worst, and so on, so improving a strong character can never come at the cost
 * of a weak one.
 *
 * **Drag order is a tie-break and nothing more.** It is applied only once the
 * sorted score vector is already fixed, so the list has real meaning to the
 * player without ever driving the allocation.
 *
 * **The result is anytime.** After each round the current selection is a valid,
 * complete, conflict-free assignment, so stopping early always yields something
 * usable.
 */
import type { Build } from "./protocol.ts";
import { clone, disjoint, unionInto, type Bitset } from "./bitset.ts";
import { itemsOf, type Portfolio, type PortfolioEntry } from "./portfolio.ts";

export interface TeamRequest {
  portfolios: Portfolio[];
  poolSize: number;
  /**
   * Character keys in the order the player dragged them. Earlier wins ties.
   * Characters missing from the list sort last, in portfolio order.
   */
  dragOrder?: readonly string[];
  /**
   * Re-solve one character against a restricted pool, for column generation.
   * Omit and phase 2 is skipped, which is a supported, cheaper mode.
   */
  resolve?: (key: string, excluded: ReadonlySet<number>) => Build[];
  /** Column-generation rounds. */
  rounds?: number;
  /** Feasibility nodes before a threshold test gives up and reports infeasible. */
  nodeBudget?: number;
}

export interface TeamAssignment {
  key: string;
  build: Build;
}

export interface TeamProgress {
  round: number;
  rounds: number;
  /** Scores ascending - the vector the player watches climb. */
  sorted: number[];
  assignment: TeamAssignment[];
}

export interface TeamResult {
  assignment: TeamAssignment[];
  sorted: number[];
  /** Characters with no valid build, so no assignment could include them. */
  unbuildable: string[];
  rounds: number;
  /**
   * True when every character had builds but no conflict-free selection existed.
   * Distinct from an empty team, and usually means the portfolios are variations
   * on the same items rather than a genuine spread.
   */
  infeasible: boolean;
}

export const DEFAULT_ROUNDS = 20;
export const DEFAULT_NODE_BUDGET = 200_000;

/** Lexicographic comparison of ascending-sorted score vectors. Positive: a wins. */
export function compareLeximin(a: readonly number[], b: readonly number[]): number {
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i]! !== right[i]!) return left[i]! - right[i]!;
  }
  return left.length - right.length;
}

interface Candidate {
  entry: PortfolioEntry;
  score: number;
}

/**
 * One build per character, all item-disjoint, every score at or above its
 * threshold. Null when no such selection exists.
 *
 * With four characters and bitset intersection this is microseconds, which is
 * what makes the binary search over thresholds affordable.
 */
function selectDisjoint(
  portfolios: readonly Portfolio[],
  thresholds: readonly number[],
  nodeBudget: number,
): PortfolioEntry[] | null {
  const options: PortfolioEntry[][] = portfolios.map((portfolio, index) =>
    portfolio.entries.filter((entry) => entry.build.score >= thresholds[index]!),
  );
  if (options.some((list) => list.length === 0)) return null;

  const words = portfolios[0]!.entries[0]!.items.length;
  const chosen = new Array<PortfolioEntry | null>(portfolios.length).fill(null);
  let nodes = 0;

  /**
   * Forward checking with dynamic MRV.
   *
   * A static character order with no propagation thrashes: it commits to the
   * highest-scoring build for the first character, then grinds through hundreds
   * of options for each of the rest before backtracking. Filtering each
   * character's surviving options at every step, failing the moment any of them
   * empties, and always branching on the most constrained character turns a
   * search that exhausted five million nodes into one that finishes immediately.
   */
  const walk = (remaining: number[], live: PortfolioEntry[][], used: Bitset): boolean => {
    if (remaining.length === 0) return true;

    let pick = 0;
    for (let i = 1; i < remaining.length; i += 1) {
      if (live[remaining[i]!]!.length < live[remaining[pick]!]!.length) pick = i;
    }
    const index = remaining[pick]!;
    const rest = remaining.filter((_, i) => i !== pick);

    for (const candidate of live[index]!) {
      nodes += 1;
      if (nodes > nodeBudget) return false;

      const next = clone(used);
      unionInto(next, candidate.items);

      const filtered = live.slice();
      let dead = false;
      for (const other of rest) {
        const survivors = live[other]!.filter((entry) => disjoint(entry.items, next));
        if (survivors.length === 0) {
          dead = true;
          break;
        }
        filtered[other] = survivors;
      }
      if (dead) continue;

      chosen[index] = candidate;
      if (walk(rest, filtered, next)) return true;
      chosen[index] = null;
    }
    return false;
  };

  const all = options.map((_, index) => index);
  return walk(all, options, new Uint32Array(words)) ? (chosen as PortfolioEntry[]) : null;
}

/** Distinct scores available to a character, descending. */
function scoreLevels(portfolio: Portfolio): number[] {
  return [...new Set(portfolio.entries.map((entry) => entry.build.score))].sort(
    (a, b) => b - a,
  );
}

export function* solveTeam(
  request: TeamRequest,
): Generator<TeamProgress, TeamResult, void> {
  const {
    portfolios,
    poolSize,
    dragOrder = [],
    resolve,
    rounds = DEFAULT_ROUNDS,
    nodeBudget = DEFAULT_NODE_BUDGET,
  } = request;

  const unbuildable = portfolios
    .filter((portfolio) => portfolio.unbuildable || portfolio.entries.length === 0)
    .map((portfolio) => portfolio.key);
  const active = portfolios.filter(
    (portfolio) => !portfolio.unbuildable && portfolio.entries.length > 0,
  );

  if (active.length === 0) {
    return { assignment: [], sorted: [], unbuildable, rounds: 0, infeasible: false };
  }

  const dragRank = (key: string): number => {
    const index = dragOrder.indexOf(key);
    return index < 0 ? dragOrder.length : index;
  };

  /**
   * Raise the floor for everyone still unfixed as high as it will go, fix the
   * characters that cannot clear it, and repeat. Four cheap binary searches.
   */
  const leximin = (): PortfolioEntry[] | null => {
    const fixed = new Array<number | null>(active.length).fill(null);
    let selection: PortfolioEntry[] | null = null;

    for (let pass = 0; pass < active.length; pass += 1) {
      const unfixed = fixed
        .map((value, index) => (value === null ? index : -1))
        .filter((index) => index >= 0);
      if (unfixed.length === 0) break;

      // Candidate floors: every score any unfixed character can actually hit.
      const levels = [
        ...new Set(unfixed.flatMap((index) => scoreLevels(active[index]!))),
      ].sort((a, b) => a - b);

      const thresholdsFor = (floor: number): number[] =>
        fixed.map((value) => (value === null ? floor : value));

      let low = 0;
      let high = levels.length - 1;
      let bestFloor: number | null = null;
      let bestSelection: PortfolioEntry[] | null = null;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const found = selectDisjoint(active, thresholdsFor(levels[mid]!), nodeBudget);
        if (found) {
          bestFloor = levels[mid]!;
          bestSelection = found;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      if (bestFloor === null || bestSelection === null) return selection;
      selection = bestSelection;

      // Anyone who cannot be pushed above the floor is bottlenecked here.
      const above = levels.filter((level) => level > bestFloor!);
      const nextLevel = above.length > 0 ? above[0]! : null;
      let fixedAny = false;
      for (const index of unfixed) {
        if (nextLevel === null) {
          fixed[index] = bestFloor;
          fixedAny = true;
          continue;
        }
        const probe = thresholdsFor(bestFloor);
        probe[index] = nextLevel;
        if (!selectDisjoint(active, probe, nodeBudget)) {
          fixed[index] = bestFloor;
          fixedAny = true;
        }
      }
      // No character is the bottleneck on its own: settle everyone here rather
      // than looping without progress.
      if (!fixedAny) {
        for (const index of unfixed) fixed[index] = bestFloor;
      }
    }

    return selection;
  };

  let first = leximin();

  /**
   * Seed a feasible team when the portfolios alone cannot produce one.
   *
   * Portfolios are generated against the full pool with conflicts ignored, so
   * every character's builds concentrate on the same strongest items. With four
   * characters that regularly leaves **no** conflict-free selection at all, and
   * phase 1 has nothing to start from.
   *
   * Solving in drag order with the running selection excluded always yields a
   * valid team, because the pool is far larger than four builds. That seed is
   * order-dependent and therefore greedy - which is exactly what phase 2 exists
   * to undo, since it only ever accepts a lexicographic improvement to the whole
   * sorted vector. The anti-greedy guarantee survives; it just moves from
   * phase 1 to phase 2 in this case.
   */
  if (!first && resolve) {
    const used = new Set<number>();
    let seeded = true;
    for (const portfolio of active) {
      const builds = resolve(portfolio.key, used);
      const seed = builds[0];
      if (!seed) {
        seeded = false;
        break;
      }
      portfolio.entries.push({ build: seed, items: itemsOf(seed, poolSize) });
      for (const item of [seed.cartridge, ...seed.modules]) used.add(item);
    }
    if (seeded) first = leximin();
  }

  if (!first) {
    return { assignment: [], sorted: [], unbuildable, rounds: 0, infeasible: true };
  }
  let selection: PortfolioEntry[] = first;

  const assignmentOf = (entries: PortfolioEntry[]): TeamAssignment[] =>
    entries
      .map((entry, index) => ({ key: active[index]!.key, build: entry.build }))
      .sort((a, b) => dragRank(a.key) - dragRank(b.key));

  const sortedOf = (entries: PortfolioEntry[]): number[] =>
    entries.map((entry) => entry.build.score).sort((a, b) => a - b);

  let sorted = sortedOf(selection);
  yield { round: 0, rounds, sorted, assignment: assignmentOf(selection) };

  // --- phase 2: column generation ---------------------------------------
  let round = 0;
  if (resolve) {
    for (round = 1; round <= rounds; round += 1) {
      // The worst-off character, with drag order breaking a tie.
      let worst = 0;
      for (let i = 1; i < selection.length; i += 1) {
        const better = selection[i]!.build.score < selection[worst]!.build.score;
        const tie =
          selection[i]!.build.score === selection[worst]!.build.score &&
          dragRank(active[i]!.key) < dragRank(active[worst]!.key);
        if (better || tie) worst = i;
      }

      const held = new Set<number>();
      selection.forEach((entry, index) => {
        if (index === worst) return;
        for (const item of [entry.build.cartridge, ...entry.build.modules]) held.add(item);
      });

      // Move one: what the worst-off can do without touching anyone's items.
      const fresh = resolve(active[worst]!.key, held);

      // Move two, the donor move: also offer it whatever strictly better-off
      // characters are holding. Accepted only if the whole vector improves.
      const betterOff = new Set<number>();
      selection.forEach((entry, index) => {
        if (index === worst) return;
        if (entry.build.score <= selection[worst]!.build.score) {
          for (const item of [entry.build.cartridge, ...entry.build.modules]) {
            betterOff.add(item);
          }
        }
      });
      const donated = resolve(active[worst]!.key, betterOff);

      const added = [...fresh, ...donated];
      if (added.length === 0) break;

      const before = active[worst]!.entries.length;
      for (const build of added) {
        active[worst]!.entries.push({ build, items: itemsOf(build, poolSize) });
      }
      if (active[worst]!.entries.length === before) break;

      const candidate = leximin();
      if (!candidate) break;
      const candidateSorted = sortedOf(candidate);
      if (compareLeximin(candidateSorted, sorted) <= 0) {
        // No lexicographic improvement: keep what we had and stop paying for
        // rounds that cannot help.
        break;
      }
      selection = candidate;
      sorted = candidateSorted;
      yield { round, rounds, sorted, assignment: assignmentOf(selection) };
    }
  }

  return {
    assignment: assignmentOf(selection),
    sorted,
    unbuildable,
    rounds: round,
    infeasible: false,
  };
}

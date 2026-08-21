/**
 * Phase 0 of the team solve: a diverse portfolio per character.
 *
 * Every portfolio is generated against the **entire pool, conflicts ignored**.
 * That is what makes the team phase anti-greedy structurally rather than
 * heuristically: no character is solved after another has already taken items,
 * so generation order confers no advantage at all.
 *
 * What is kept is not the best build repeated with cosmetic variation but a
 * spread: builds that reuse items already covered are penalised, so the leximin
 * phase has genuinely different options to trade between.
 */
import type { Build } from "./protocol.ts";
import { bitsetOf, type Bitset } from "./bitset.ts";

export interface PortfolioEntry {
  build: Build;
  /** The build's items - cartridge and modules - as a bitset over the pool. */
  items: Bitset;
}

export interface Portfolio {
  /** Whatever identifies the character to the caller. */
  key: string;
  entries: PortfolioEntry[];
  /** True when the character has no valid full-set build at all. */
  unbuildable: boolean;
}

export const DEFAULT_DIVERSITY = 0.15;

export function itemsOf(build: Build, poolSize: number): Bitset {
  return bitsetOf(poolSize, [build.cartridge, ...build.modules]);
}

/**
 * Trim a solve's builds to a spread of `size`.
 *
 * Greedy by `score - diversity * (mean usage of this build's items so far)`.
 *
 * The penalty counts **how many times** each item has already been kept, not
 * merely whether it has been. An earlier version measured overlap against the
 * union of everything kept, and that saturates: once the union is large every
 * remaining build overlaps it completely, the penalty stops discriminating, and
 * the portfolio collapses onto a few dozen items. Four characters then have no
 * conflict-free selection between them at all - the team phase returns nothing.
 */
export function diversify(
  builds: readonly Build[],
  poolSize: number,
  size: number,
  diversity = DEFAULT_DIVERSITY,
): PortfolioEntry[] {
  const remaining = builds
    .map((build) => ({
      entry: { build, items: itemsOf(build, poolSize) } as PortfolioEntry,
      pieces: [build.cartridge, ...build.modules],
    }))
    .sort((a, b) => b.entry.build.score - a.entry.build.score);

  const usage = new Uint16Array(poolSize);
  const kept: PortfolioEntry[] = [];
  const taken = new Uint8Array(remaining.length);

  while (kept.length < size) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      if (taken[i]) continue;
      const candidate = remaining[i]!;
      let used = 0;
      for (const item of candidate.pieces) used += usage[item]!;
      const value =
        candidate.entry.build.score - (diversity * used) / candidate.pieces.length;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const chosen = remaining[bestIndex]!;
    taken[bestIndex] = 1;
    kept.push(chosen.entry);
    for (const item of chosen.pieces) usage[item] = usage[item]! + 1;
  }

  return kept;
}

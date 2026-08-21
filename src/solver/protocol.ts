/**
 * The wire between the app and whatever is running the search.
 *
 * The same types serve the Worker host and the inline host, so nothing above
 * the solver knows which one it got.
 */
import type { Tier } from "../domain/cartridges.ts";
import type { Tiling } from "../domain/tilings.ts";

export interface SolveProgress {
  /** Combinations finished. Every phase has a real denominator. */
  done: number;
  total: number;
  /** The best complete build so far. Stop always yields something usable. */
  best: Build | null;
}

export interface Build {
  /** Pool index of the cartridge. */
  cartridge: number;
  /** Pool indices of the modules, aligned with `tiling.pieces`. */
  modules: number[];
  tiling: Tiling;
  score: number;
  vector: Float32Array;
  /**
   * True when branch and bound closed, so **this packing with this cartridge**
   * has no better module assignment. It is deliberately not a claim of global
   * optimality: packings and cartridges are enumerated exhaustively, but the
   * module beam inside each one is not proved except for the winner. False
   * means even that narrower claim did not close within budget.
   *
   * The UI must render the distinction rather than implying certainty.
   */
  proven: boolean;
  /** Active set tiers whose values nobody has measured yet. */
  unknownTiers: Tier[];
}

export interface SolveResult {
  best: Build | null;
  /** Every build considered good enough to keep, best first. */
  portfolio: Build[];
  /** Combinations examined. */
  examined: number;
  /** True when no cartridge and tiling combination existed at all. */
  unbuildable: boolean;
}

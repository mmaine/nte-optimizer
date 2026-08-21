/**
 * Cartridge sets: the four module shapes each one needs to switch its bonuses on.
 *
 * A set needs four *specific distinct* shapes - not four of a type. Every set's
 * four shapes total exactly 12 cells, so on a 20-cell board the requirement
 * fixes 12 cells and leaves 8 free. That is the optimizer's search space.
 *
 * Bonus tiers count how many *distinct* required shapes are on the board, in any
 * order and any position. Duplicates do not count twice.
 */
import type { ShapeId } from "./shapes.ts";

export type SetName = keyof typeof REQUIRED_PIECES;

export const REQUIRED_PIECES = {
  "Crimson: Twin Butterflies": ["cell2_style2", "cell3_style1", "cell3_style6", "cell4_style5"],
  "Devil's Blood: Curse": ["cell2_style2", "cell3_style2", "cell3_style4", "cell4_style6"],
  Diabolos: ["cell2_style2", "cell3_style4", "cell3_style6", "cell4_style1"],
  "Fireflies and the Forest": ["cell2_style1", "cell3_style2", "cell3_style3", "cell4_style6"],
  "Kingdom's Guard": ["cell3_style1", "cell3_style2", "cell3_style5", "cell3_style6"],
  "Lost Radiance": ["cell2_style1", "cell3_style3", "cell3_style5", "cell4_style2"],
  "Quiet Manor": ["cell2_style1", "cell2_style2", "cell4_style2", "cell4_style6"],
  "Shadow Creed": ["cell2_style1", "cell2_style2", "cell4_style1", "cell4_style6"],
  "Speedy Hedgehog": ["cell3_style3", "cell3_style4", "cell3_style5", "cell3_style6"],
  "Street Boxer": ["cell2_style1", "cell3_style1", "cell3_style5", "cell4_style5"],
  "Thea's Night Tavern": ["cell3_style1", "cell3_style2", "cell3_style3", "cell3_style4"],
  "Tiny Big Adventure": ["cell2_style1", "cell2_style2", "cell4_style1", "cell4_style5"],
} as const satisfies Record<string, readonly [ShapeId, ShapeId, ShapeId, ShapeId]>;

export const SET_NAMES = Object.keys(REQUIRED_PIECES) as SetName[];

/**
 * Set ids as the packets spell them, confirmed against everness's cartridge
 * boxes (`Testeqbox_<id>`) - the only source that names the three sets this
 * account does not own. Those three are Psyche, Shield and Heal; an earlier
 * guess of Blood, Night and Kingdom was wrong on all three.
 */
export const SET_IDS: Record<string, SetName> = {
  Attack_orange: "Shadow Creed",
  Chaos_orange: "Diabolos",
  Cosmos_orange: "Lost Radiance",
  GetEfficiency_orange: "Speedy Hedgehog",
  Incantation_orange: "Crimson: Twin Butterflies",
  Lakshana_orange: "Street Boxer",
  Nature_orange: "Fireflies and the Forest",
  Psychically_orange: "Quiet Manor",
  Mag_orange: "Tiny Big Adventure",
  // Not owned, so never yet seen in a capture.
  Psyche_orange: "Devil's Blood: Curse",
  Heal_orange: "Thea's Night Tavern",
  Shield_orange: "Kingdom's Guard",
};

export type Tier = 2 | 4;

/** Which bonus tiers a board unlocks: [], [2] or [2, 4]. */
export function activeTiers(set: SetName, shapesOnBoard: Iterable<ShapeId>): Tier[] {
  const required = new Set<string>(REQUIRED_PIECES[set]);
  const present = new Set<string>();
  for (const shape of shapesOnBoard) {
    if (required.has(shape)) present.add(shape);
  }
  if (present.size >= 4) return [2, 4];
  return present.size >= 2 ? [2] : [];
}

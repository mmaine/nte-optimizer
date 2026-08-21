/**
 * Cartridge set bonuses.
 *
 * The bonus *values* are the one piece of the model no available source
 * carries: the capture never sends them, and everness's `items.json` holds only
 * the cartridge boxes, not their effects. They have to be read in game or
 * scraped from a guide.
 *
 * Until then every tier is explicitly unknown and contributes **nothing**. The
 * requirements are firm that the app never invents numbers, so a missing bonus
 * shows as a gap in the UI rather than as a plausible-looking zero the player
 * cannot tell apart from a real one.
 */
import { activeTiers, type SetName, type Tier } from "./cartridges.ts";
import type { ShapeId } from "./shapes.ts";
import { vectorFrom, type StatPair } from "./statvec.ts";

export interface TierBonus {
  unknown: boolean;
  stats: StatPair[];
}

export interface SetBonusTable {
  format: string;
  format_version: number;
  sets: Record<string, Record<"2" | "4", TierBonus>>;
}

export interface SetBonusResult {
  tiers: Tier[];
  vector: Float32Array;
  /** Tiers that are active but whose values nobody has measured yet. */
  unknownTiers: Tier[];
}

/** What a board's set bonuses contribute, and what is missing from that answer. */
export function setBonus(
  table: SetBonusTable,
  set: SetName,
  shapesOnBoard: readonly ShapeId[],
): SetBonusResult {
  const tiers = activeTiers(set, shapesOnBoard);
  const entry = table.sets[set];
  const pairs: StatPair[] = [];
  const unknownTiers: Tier[] = [];

  for (const tier of tiers) {
    const bonus = entry?.[String(tier) as "2" | "4"];
    if (!bonus || bonus.unknown) {
      unknownTiers.push(tier);
      continue;
    }
    pairs.push(...bonus.stats);
  }

  return { tiers, vector: vectorFrom(pairs), unknownTiers };
}

/** Sets with at least one unmeasured tier, for the UI to flag up front. */
export function incompleteSets(table: SetBonusTable): SetName[] {
  const out: SetName[] = [];
  for (const [set, tiers] of Object.entries(table.sets)) {
    if (tiers["2"].unknown || tiers["4"].unknown) out.push(set as SetName);
  }
  return out.sort();
}

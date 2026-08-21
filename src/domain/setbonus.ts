/** Cartridge set bonuses, classified with the same modes as Arc effects. */
import { activeTiers, type SetName, type Tier } from "./cartridges.ts";
import type { ShapeId } from "./shapes.ts";
import { vectorFrom, type StatId, type StatPair } from "./statvec.ts";

export type BonusMode = "always" | "toggle" | "stacks" | "duration" | "unmodellable";

export interface TierBonus {
  description: string;
  mode: BonusMode;
  stats: Array<{ stat: StatId; value: number }>;
  why: string;
  max_stacks?: number;
  /** Kept for future source gaps; v2 classifies every current tier. */
  unknown?: boolean;
}

export interface SetBonusTable {
  format: string;
  format_version: number;
  sets: Record<string, Record<"2" | "4", TierBonus>>;
}

export interface OmittedTier {
  tier: Tier;
  mode: "duration" | "unmodellable";
  why: string;
}

export interface SetBonusResult {
  tiers: Tier[];
  vector: Float32Array;
  unknownTiers: Tier[];
  omittedTiers: OmittedTier[];
}

/** What a board's set bonuses contribute, and what is missing from that answer. */
export function setBonus(
  table: SetBonusTable,
  set: SetName,
  shapesOnBoard: readonly ShapeId[],
  targetTier: Tier = 4,
): SetBonusResult {
  const tiers = activeTiers(set, shapesOnBoard);
  const entry = table.sets[set];
  const pairs: StatPair[] = [];
  const unknownTiers: Tier[] = [];
  const omittedTiers: OmittedTier[] = [];

  for (const tier of tiers) {
    if (tier > targetTier) continue;
    const bonus = entry?.[String(tier) as "2" | "4"];
    if (!bonus || bonus.unknown) {
      unknownTiers.push(tier);
      continue;
    }
    if (bonus.mode === "duration" || bonus.mode === "unmodellable") {
      omittedTiers.push({ tier, mode: bonus.mode, why: bonus.why });
      continue;
    }

    // ponytail: selecting 2+4 means aiming for stated max stacks; add a stack control only if users need partial uptime.
    const multiplier = bonus.mode === "stacks" ? bonus.max_stacks ?? 0 : 1;
    pairs.push(...bonus.stats.map(({ stat, value }) => ({ stat, value: value * multiplier })));
  }

  return { tiers, vector: vectorFrom(pairs), unknownTiers, omittedTiers };
}

/** Sets with at least one unmeasured tier, for the UI to flag up front. */
export function incompleteSets(table: SetBonusTable): SetName[] {
  const out: SetName[] = [];
  for (const [set, tiers] of Object.entries(table.sets)) {
    if (!tiers["2"] || !tiers["4"] || tiers["2"].unknown || tiers["4"].unknown) {
      out.push(set as SetName);
    }
  }
  return out.sort();
}

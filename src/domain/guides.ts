/**
 * Published build guidance: targets and a ranked substat priority per character.
 *
 * The **weights the solver runs with come from the ranking**, not from a number
 * somebody typed. A rank is what a guide actually publishes; inventing weights
 * from it in one place keeps every character on the same scale.
 *
 * `data-src/guides.json` is committed and human-reviewed. Nothing is scraped at
 * runtime: CORS forbids it, and a site redesign should break a script somebody
 * runs deliberately rather than the app in a player's hands.
 */
import { isKnownStat, type StatId } from "./statvec.ts";
import type { StatTarget } from "./scoring.ts";

export interface GuideVariant {
  /** "Main DPS", "SubDPS", "Break", "DoT" - a character can have several. */
  name: string;
  /** Recommended endgame stats: a floor to reach, not a ceiling. */
  targets: Array<{ stat: string; target: number }>;
  /** Substat priority, best first. */
  priority: string[];
}

export interface CharacterGuide {
  /** The `GA_<key>_*` ability key, so it joins to a capture directly. */
  key: string;
  source: string;
  updated: string;
  variants: GuideVariant[];
}

export interface GuideTable {
  format: string;
  format_version: number;
  characters: CharacterGuide[];
}

/**
 * Rank to weight.
 *
 * Linear from `top` down to 1: rank 1 is worth `top`, and the last ranked stat
 * is still worth something. A geometric curve would make anything past third
 * place worthless, which is not what "priority" means on a guide - the lower
 * ranks are where a shortfall is *supposed* to land, not stats to ignore.
 */
export const TOP_WEIGHT = 5;

export function weightForRank(rank: number, total: number): number {
  if (total <= 1) return TOP_WEIGHT;
  const step = (TOP_WEIGHT - 1) / (total - 1);
  return TOP_WEIGHT - step * rank;
}

/** The scoring targets a variant implies. */
export function targetsFromGuide(variant: GuideVariant): StatTarget[] {
  const ranked = variant.priority.filter(isKnownStat);
  const rankOf = new Map<string, number>(ranked.map((stat, index) => [stat, index]));

  const out: StatTarget[] = [];
  for (const entry of variant.targets) {
    if (!isKnownStat(entry.stat)) continue;
    const rank = rankOf.get(entry.stat);
    out.push({
      stat: entry.stat as StatId,
      target: entry.target,
      // A stat with a target but no place in the ranking still matters; it just
      // sits at the bottom rather than being dropped.
      weight: rank === undefined ? 1 : weightForRank(rank, ranked.length),
    });
  }
  return out;
}

export function guideFor(table: GuideTable, key: string): CharacterGuide | null {
  return table.characters.find((entry) => entry.key === key) ?? null;
}

export function variantFor(
  guide: CharacterGuide | null,
  name: string | null,
): GuideVariant | null {
  if (!guide || guide.variants.length === 0) return null;
  if (name) return guide.variants.find((variant) => variant.name === name) ?? guide.variants[0]!;
  return guide.variants[0]!;
}

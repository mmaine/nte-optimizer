/**
 * Human-readable names for the stat ids the capture speaks in.
 *
 * The game's own labels are harvested into `gamedata.statNames` by
 * `tools/prune-gamedata.ts`, so `CritBase` reads "CRIT Rate" because everness
 * says it does, not because someone typed it here.
 *
 * The mirror does not name every id the capture carries. The gaps are filled
 * below, each with its reason, and each marked so the UI can say the label is
 * derived rather than official. Nothing here invents a *number* - only a name
 * for a stat whose value comes from the capture either way.
 *
 * Pure: no DOM, no imports from `ui/`.
 */

export interface StatLabel {
  /** What to show. */
  name: string;
  /** Render the value as a percentage. */
  percent: boolean;
  /**
   * Where the name came from. `game` is everness's own label; `derived` is
   * completed here from a sibling id and is not the game's wording.
   */
  source: "game" | "derived";
  /** Set on `derived` labels: why this is the name. */
  note?: string;
}

type Harvested = Record<string, { name: string; percent: boolean } | undefined>;

/**
 * Ids everness never labels.
 *
 * The flat/percent pairs are the interesting case: everness names only the
 * percentage member of each pair (`HPMaxUp` is "HP"), which would make a flat
 * and a percentage bonus render identically. They are distinguished here.
 */
const FALLBACKS: Record<string, StatLabel> = {
  HPMaxAdd: {
    name: "HP",
    percent: false,
    source: "derived",
    note: "flat counterpart of HPMaxUp, which everness names 'HP'",
  },
  AtkAdd: {
    name: "ATK",
    percent: false,
    source: "derived",
    note: "flat counterpart of AtkUp, which everness names 'ATK'",
  },
  DefAdd: {
    name: "DEF",
    percent: false,
    source: "derived",
    note: "flat counterpart of DefUp, which everness names 'DEF'",
  },
  MagBase: {
    name: "Cycle Intensity",
    percent: false,
    source: "derived",
    note:
      "everness names `Mag` 'Cycle Intensity', and `UnbalIntensity`/" +
      "`UnbalIntensityBase` are both 'Break Intensity', so the Base suffix is " +
      "the same stat. Note this contradicts the older guess that MagBase was Break.",
  },
  DamageUpGeneralBase: {
    name: "DMG Bonus",
    percent: true,
    source: "derived",
    note: "the elemental ids are '<Element> DMG Bonus'; this one names no element",
  },
  DamageUpPsycheBase: {
    name: "Psyche DMG Bonus",
    percent: true,
    source: "derived",
    note: "pattern completed from Cosmos/Chaos/Incantation, which everness does name",
  },
  DamageUpLakshanaBase: {
    name: "Lakshana DMG Bonus",
    percent: true,
    source: "derived",
    note: "pattern completed from Cosmos/Chaos/Incantation, which everness does name",
  },
  DamageUpPsychicallyBase: {
    name: "Psychically DMG Bonus",
    percent: true,
    source: "derived",
    note:
      "a seventh damage-bonus id with no matching element; appears on 19 real " +
      "items. Named from the id itself because nothing else describes it.",
  },
};

/**
 * Ids where the game data's own percent flag contradicts the values it ships.
 *
 * everness marks these `bShowPercent: false`, but the capture carries them as
 * fractions in exactly the range of the stats it *does* mark as percentages -
 * `HealUp` spans 0.069..0.345 and `DamageUpNatureBase` spans 0.075..0.375, the
 * same range as Chaos/Cosmos/Incantation DMG Bonus. Rendering them raw printed
 * "Healing Bonus 0.1" where the game shows 10%.
 *
 * The name is still theirs; only the flag is overridden.
 */
const PERCENT_OVERRIDES: Record<string, boolean> = {
  HealUp: true,
  DamageUpNatureBase: true,
};

export function statLabel(harvested: Harvested, id: string): StatLabel {
  const fromGame = harvested[id];
  if (fromGame) {
    return {
      name: fromGame.name,
      percent: PERCENT_OVERRIDES[id] ?? fromGame.percent,
      source: "game",
    };
  }
  const fallback = FALLBACKS[id];
  if (fallback) return fallback;
  // An id nobody names: show it raw rather than inventing wording for it, so a
  // decoder change that introduces a new stat is visible instead of disguised.
  return { name: id, percent: false, source: "derived", note: "no known label" };
}

/**
 * A stat's value as the game would show it.
 *
 * Percentages are carried as fractions everywhere in the app, so 0.125 is
 * 12.5%. Flat values are integers often enough that a trailing `.0` is noise.
 */
export function formatStatValue(label: StatLabel, value: number): string {
  if (label.percent) {
    const percent = value * 100;
    const rounded = Math.abs(percent - Math.round(percent)) < 0.05;
    return `${rounded ? Math.round(percent) : percent.toFixed(1)}%`;
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

/** `CRIT Rate 12.5%`, for one-line rendering. */
export function formatStat(harvested: Harvested, id: string, value: number): string {
  const label = statLabel(harvested, id);
  return `${label.name} ${formatStatValue(label, value)}`;
}

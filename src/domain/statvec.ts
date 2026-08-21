/**
 * The fixed stat vector.
 *
 * Every contribution - module main, module substat, cartridge main, set bonus,
 * console trait, Arc - is normalised into one `Float32Array` with a fixed slot
 * per stat, and the whole owned pool lives in a single flat array. Scoring a
 * partial build then costs one vector add. Nearly all of the solver's speed is
 * this decision, which is why it is made before any solver code exists.
 *
 * Slots are raw stat ids, never display names: naming is presentation and
 * belongs in the UI, where it can change without invalidating stored data.
 */

/** Elements the roster actually has. */
export const ELEMENTS = [
  "Chaos",
  "Cosmos",
  "Incantation",
  "Lakshana",
  "Nature",
  "Psyche",
] as const;

/**
 * Slot order is part of the on-disk contract for anything that caches vectors,
 * so append only - never reorder.
 *
 * The first eleven are the stats that appear as substats; the rest appear only
 * as mains. `DamageUpPsychicallyBase` is a seventh damage-bonus id with no
 * matching element - it shows up on 19 real items, so it gets a slot whatever
 * it turns out to mean.
 */
export const STAT_SLOTS = [
  "HPMaxAdd",
  "HPMaxUp",
  "AtkAdd",
  "AtkUp",
  "DefAdd",
  "DefUp",
  "CritBase",
  "CritDamageBase",
  "MagBase",
  "UnbalIntensityBase",
  "DamageUpGeneralBase",
  "HealUp",
  "DamageUpChaosBase",
  "DamageUpCosmosBase",
  "DamageUpIncantationBase",
  "DamageUpLakshanaBase",
  "DamageUpNatureBase",
  "DamageUpPsycheBase",
  "DamageUpPsychicallyBase",

  // --- appended for Arcs. Slot order is a contract: append only. ---
  //
  // `AtkBase` is the Arc's flat ATK and is deliberately NOT folded into
  // `AtkAdd`: the Arc's ATK scales with ATK% and gear's flat ATK does not, so
  // they are different quantities that happen to share a unit.
  "AtkBase",
  "ChargeGetEfficiencyBase",
  "DefIgnore",
  // `UnbalIntensity` and `Mag` appear only in Arc effect tables, while gear uses
  // `UnbalIntensityBase` and `MagBase`. They are probably the same stats spelled
  // differently, but nothing confirms it - and merging two stats wrongly is a
  // worse error than carrying two slots, so they stay separate until measured.
  "UnbalIntensity",
  "Mag",
] as const;

export type StatId = (typeof STAT_SLOTS)[number];

export const SLOT_COUNT = STAT_SLOTS.length;

const SLOT_INDEX = new Map<string, number>(STAT_SLOTS.map((stat, index) => [stat, index]));

/** The slot for a stat id, or -1 for one the model has no place for. */
export function slotOf(stat: string): number {
  return SLOT_INDEX.get(stat) ?? -1;
}

export function isKnownStat(stat: string): stat is StatId {
  return SLOT_INDEX.has(stat);
}

/** The damage-bonus slot a character's own element reads. */
export function elementSlot(element: string | null): number {
  return element === null ? -1 : slotOf(`DamageUp${element}Base`);
}

export function emptyVector(): Float32Array {
  return new Float32Array(SLOT_COUNT);
}

/**
 * A flat pool: `count` vectors laid end to end, so an item's contribution is a
 * subarray rather than an object.
 */
export function emptyPool(count: number): Float32Array {
  return new Float32Array(count * SLOT_COUNT);
}

export function poolSlice(pool: Float32Array, index: number): Float32Array {
  return pool.subarray(index * SLOT_COUNT, (index + 1) * SLOT_COUNT);
}

/** `into += from`. Both must be full-length vectors. */
export function addInto(into: Float32Array, from: Float32Array): void {
  for (let i = 0; i < SLOT_COUNT; i += 1) into[i] = into[i]! + from[i]!;
}

/** `into += pool[index]`, without materialising a subarray. */
export function addPoolInto(into: Float32Array, pool: Float32Array, index: number): void {
  const base = index * SLOT_COUNT;
  for (let i = 0; i < SLOT_COUNT; i += 1) into[i] = into[i]! + pool[base + i]!;
}

export function subtractInto(into: Float32Array, from: Float32Array): void {
  for (let i = 0; i < SLOT_COUNT; i += 1) into[i] = into[i]! - from[i]!;
}

export type StatPair = { stat: string; value: number | null };

/**
 * Fold a list of `{stat, value}` into a vector.
 *
 * Unknown stats and null values are skipped: a main stat whose displayed value
 * the game never transmits is a real, expected null, not a parse failure.
 */
export function vectorFrom(pairs: Iterable<StatPair>, into?: Float32Array): Float32Array {
  const vector = into ?? emptyVector();
  for (const { stat, value } of pairs) {
    if (value === null) continue;
    const slot = slotOf(stat);
    if (slot >= 0) vector[slot] = vector[slot]! + value;
  }
  return vector;
}

/** Non-zero slots, for display and for test failure messages. */
export function describe(vector: Float32Array): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    if (vector[i] !== 0) out[STAT_SLOTS[i]!] = vector[i]!;
  }
  return out;
}

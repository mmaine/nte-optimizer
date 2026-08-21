import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAIN_STAT_EPSILON,
  compile,
  explain,
  score,
  upperBound,
} from "../src/domain/scoring.ts";
import {
  SLOT_COUNT,
  STAT_SLOTS,
  addInto,
  describe as describeVector,
  elementSlot,
  emptyPool,
  emptyVector,
  poolSlice,
  slotOf,
  vectorFrom,
} from "../src/domain/statvec.ts";

const config = {
  targets: [
    { stat: "CritBase" as const, target: 0.7, weight: 3 },
    { stat: "CritDamageBase" as const, target: 2.0, weight: 3 },
    { stat: "AtkUp" as const, target: 0.5, weight: 1 },
  ],
};

const withStats = (pairs: Record<string, number>) =>
  vectorFrom(Object.entries(pairs).map(([stat, value]) => ({ stat, value })));

describe("stat vector", () => {
  it("gives every stat id its own slot and never reorders", () => {
    expect(new Set(STAT_SLOTS).size).toBe(SLOT_COUNT);
    // Slot order is an on-disk contract; append only.
    expect(STAT_SLOTS[0]).toBe("HPMaxAdd");
    expect(slotOf("HPMaxAdd")).toBe(0);
    expect(slotOf("NotAStat")).toBe(-1);
  });

  it("skips main stats whose value the game never transmits", () => {
    const vector = vectorFrom([
      { stat: "CritBase", value: null },
      { stat: "CritBase", value: 0.06 },
    ]);
    // Float32 keeps ~7 digits; substats carry three, so the storage is exact
    // enough and the rounding never reaches the score.
    expect(Object.keys(describeVector(vector))).toEqual(["CritBase"]);
    expect(vector[slotOf("CritBase")]).toBeCloseTo(0.06, 6);
  });

  it("resolves a character's own damage-bonus slot", () => {
    expect(elementSlot("Incantation")).toBe(slotOf("DamageUpIncantationBase"));
    expect(elementSlot(null)).toBe(-1);
  });

  it("adds through a flat pool without allocating per item", () => {
    const pool = emptyPool(3);
    poolSlice(pool, 1).set(withStats({ CritBase: 0.1 }));
    const total = emptyVector();
    addInto(total, poolSlice(pool, 1));
    addInto(total, poolSlice(pool, 1));
    expect(total[slotOf("CritBase")]).toBeCloseTo(0.2, 6);
  });
});

describe("scoring", () => {
  const compiled = compile(config);

  it("is the weighted mean of per-stat attainment", () => {
    // Half of every target, so every attainment is 0.5.
    const half = withStats({ CritBase: 0.35, CritDamageBase: 1.0, AtkUp: 0.25 });
    expect(score(half, compiled)).toBeCloseTo(0.5, 5);
  });

  it("saturates at the target rather than rewarding a ceiling", () => {
    const met = withStats({ CritBase: 0.7, CritDamageBase: 2.0, AtkUp: 0.5 });
    const report = explain(met, compiled);
    expect(report.base).toBeCloseTo(1, 5);
    expect(report.complete).toBe(true);
    for (const stat of report.stats) expect(stat.attainment).toBe(1);
  });

  it("puts the shortfall on the lowest-weighted stat", () => {
    // Missing the weight-1 stat entirely costs less than missing a weight-3 one.
    const missingLight = withStats({ CritBase: 0.7, CritDamageBase: 2.0 });
    const missingHeavy = withStats({ CritDamageBase: 2.0, AtkUp: 0.5 });
    expect(score(missingLight, compiled)).toBeGreaterThan(score(missingHeavy, compiled));
  });

  it("breaks a tie at 1.0 by overshoot, and only by a little", () => {
    const met = withStats({ CritBase: 0.7, CritDamageBase: 2.0, AtkUp: 0.5 });
    const over = withStats({ CritBase: 0.9, CritDamageBase: 2.0, AtkUp: 0.5 });
    expect(score(over, compiled)).toBeGreaterThan(score(met, compiled));
    // Overshoot must not outweigh actually reaching a target.
    const shortOnOne = withStats({ CritBase: 3.0, CritDamageBase: 2.0, AtkUp: 0.0 });
    expect(score(shortOnOne, compiled)).toBeLessThan(score(met, compiled));
  });

  it("stops paying for overshoot past the cap", () => {
    const double = withStats({ CritBase: 1.4, CritDamageBase: 2.0, AtkUp: 0.5 });
    const quadruple = withStats({ CritBase: 2.8, CritDamageBase: 2.0, AtkUp: 0.5 });
    expect(score(quadruple, compiled)).toBeCloseTo(score(double, compiled), 6);
  });

  it("lets the cartridge main stat break ties but never decide a build", () => {
    const met = withStats({ CritBase: 0.7, CritDamageBase: 2.0, AtkUp: 0.5 });
    const ranked = compile({ ...config, mainStatRank: { CritDamageBase: 1 } });
    const withMain = score(met, ranked, slotOf("CritDamageBase"));
    expect(withMain - score(met, ranked)).toBeCloseTo(DEFAULT_MAIN_STAT_EPSILON, 8);

    // A build one whole weight-1 target short cannot be rescued by the epsilon.
    const short = withStats({ CritBase: 0.7, CritDamageBase: 2.0 });
    expect(score(short, ranked, slotOf("CritDamageBase"))).toBeLessThan(
      score(met, ranked),
    );
  });

  it("ignores stats with no target", () => {
    const irrelevant = withStats({ HealUp: 5, MagBase: 900 });
    expect(score(irrelevant, compiled)).toBe(0);
  });

  it("bounds any completion of a partial build", () => {
    const partial = withStats({ CritBase: 0.35 });
    const best = withStats({ CritBase: 0.35, CritDamageBase: 2.0, AtkUp: 0.5 });
    const bound = upperBound(partial, best, compiled);
    const finished = emptyVector();
    addInto(finished, partial);
    addInto(finished, best);
    // Admissible: the bound must never sit below what the completion scores.
    expect(bound).toBeGreaterThanOrEqual(score(finished, compiled));
    const worse = withStats({ CritDamageBase: 1.0 });
    const reached = emptyVector();
    addInto(reached, partial);
    addInto(reached, worse);
    expect(bound).toBeGreaterThanOrEqual(score(reached, compiled));
  });

  it("reports zero rather than dividing by an empty weight sum", () => {
    const empty = compile({ targets: [] });
    expect(score(emptyVector(), empty)).toBe(0);
    expect(explain(emptyVector(), empty).total).toBe(0);
  });
});

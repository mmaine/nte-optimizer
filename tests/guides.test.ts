import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TOP_WEIGHT,
  guideFor,
  targetsFromGuide,
  variantFor,
  weightForRank,
  type GuideTable,
} from "../src/domain/guides.ts";

const table = JSON.parse(readFileSync("data-src/guides.json", "utf8")) as GuideTable;

const variant = {
  name: "Main DPS",
  targets: [
    { stat: "CritBase", target: 0.7 },
    { stat: "CritDamageBase", target: 2.0 },
    { stat: "AtkUp", target: 0.5 },
    { stat: "HPMaxUp", target: 0.3 },
  ],
  priority: ["CritDamageBase", "CritBase", "AtkUp"],
};

describe("rank to weight", () => {
  it("puts the top rank highest and keeps the last one meaningful", () => {
    expect(weightForRank(0, 3)).toBe(TOP_WEIGHT);
    expect(weightForRank(2, 3)).toBe(1);
    // The bottom of the ranking is where a shortfall should land, not a stat to
    // ignore entirely.
    expect(weightForRank(2, 3)).toBeGreaterThan(0);
  });

  it("descends monotonically", () => {
    const weights = [0, 1, 2, 3, 4].map((rank) => weightForRank(rank, 5));
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]!).toBeLessThan(weights[i - 1]!);
    }
  });

  it("handles a single ranked stat", () => {
    expect(weightForRank(0, 1)).toBe(TOP_WEIGHT);
  });
});

describe("guide to targets", () => {
  it("weights targets by their place in the ranking", () => {
    const targets = targetsFromGuide(variant);
    const byStat = new Map(targets.map((entry) => [entry.stat, entry]));
    expect(byStat.get("CritDamageBase")!.weight).toBe(TOP_WEIGHT);
    expect(byStat.get("CritDamageBase")!.weight).toBeGreaterThan(
      byStat.get("CritBase")!.weight,
    );
    expect(byStat.get("CritBase")!.weight).toBeGreaterThan(byStat.get("AtkUp")!.weight);
  });

  it("keeps a target that the ranking does not mention", () => {
    const targets = targetsFromGuide(variant);
    const hp = targets.find((entry) => entry.stat === "HPMaxUp")!;
    expect(hp.weight).toBe(1);
    expect(hp.target).toBe(0.3);
  });

  it("drops a stat the model has no slot for", () => {
    const targets = targetsFromGuide({
      name: "x",
      targets: [{ stat: "NotAStat", target: 1 }],
      priority: ["NotAStat"],
    });
    expect(targets).toEqual([]);
  });
});

describe("guide lookup", () => {
  it("returns null for a character with no published guide", () => {
    expect(guideFor(table, "Zankou")).toBeNull();
    expect(variantFor(null, null)).toBeNull();
  });

  it("falls back to the first variant when the named one is gone", () => {
    const guide = {
      key: "Zankou",
      source: "x",
      updated: "2026-08-21",
      variants: [variant, { ...variant, name: "SubDPS" }],
    };
    expect(variantFor(guide, "SubDPS")!.name).toBe("SubDPS");
    // A variant that was renamed upstream must not blank the character out.
    expect(variantFor(guide, "Removed")!.name).toBe("Main DPS");
    expect(variantFor(guide, null)!.name).toBe("Main DPS");
  });

  it("ships an empty table rather than invented guidance", () => {
    // Prydwen's data could not be obtained; a plausible-looking guess would be
    // worse than none, because the player could not tell it apart from real.
    expect(table.characters).toEqual([]);
    expect(table.format).toBe("nte-guides");
  });
});

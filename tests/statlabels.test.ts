import { describe, expect, it } from "vitest";

import { formatStat, formatStatValue, statLabel } from "../src/domain/statlabels.ts";
import gamedata from "../src/generated/gamedata.json" with { type: "json" };
import { STAT_SLOTS } from "../src/domain/statvec.ts";

const harvested = gamedata.statNames as Record<string, { name: string; percent: boolean }>;

describe("stat labels", () => {
  it("prefers the game's own wording", () => {
    const label = statLabel(harvested, "CritBase");
    expect(label.name).toBe("CRIT Rate");
    expect(label.source).toBe("game");
  });

  it("labels every stat the app can hold a value for", () => {
    // A slot with no label would render a raw id at the player, which is the
    // thing this module exists to prevent.
    const unlabelled = STAT_SLOTS.filter((id) => statLabel(harvested, id).name === id);
    expect(unlabelled).toEqual([]);
  });

  it("marks derived names so the UI can flag them", () => {
    const derived = statLabel(harvested, "MagBase");
    expect(derived.source).toBe("derived");
    expect(derived.note).toBeTruthy();
  });

  it("distinguishes a flat bonus from a percentage one", () => {
    // everness names both `HPMaxUp` and nothing at all for `HPMaxAdd`; rendering
    // them identically would make "HP 200" and "HP 2.5%" indistinguishable.
    expect(formatStat(harvested, "HPMaxUp", 0.025)).toBe("HP 2.5%");
    expect(formatStat(harvested, "HPMaxAdd", 200)).toBe("HP 200");
  });

  it("renders percentages from fractions and drops noise decimals", () => {
    const percent = statLabel(harvested, "CritBase");
    expect(formatStatValue(percent, 0.5)).toBe("50%");
    expect(formatStatValue(percent, 0.125)).toBe("12.5%");
    const flat = statLabel(harvested, "UnbalIntensityBase");
    expect(formatStatValue(flat, 180)).toBe("180");
  });

  it("keeps Break and Cycle apart", () => {
    // everness names `Mag` "Cycle Intensity" and `UnbalIntensity` "Break
    // Intensity", which is what settles these two being different stats.
    expect(statLabel(harvested, "UnbalIntensityBase").name).toBe("Break Intensity");
    expect(statLabel(harvested, "MagBase").name).toBe("Cycle Intensity");
  });

  it("shows an unknown id raw rather than inventing wording", () => {
    const label = statLabel(harvested, "SomeStatNobodyKnows");
    expect(label.name).toBe("SomeStatNobodyKnows");
  });
});

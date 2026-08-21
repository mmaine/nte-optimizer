import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BASE_CRIT_DAMAGE,
  BASE_CRIT_RATE,
  MULTIPLIER,
  baseStat,
  consoleTrait,
  hasMultiplier,
  totalAtk,
  traitContribution,
} from "../src/domain/stats.ts";

const gamedata = JSON.parse(readFileSync("src/generated/gamedata.json", "utf8"));
const esperByName = (name: string) =>
  gamedata.espers.find((esper: { name: string }) => esper.name === name);
const curve = (esper: { stats: { id_stats: string; values: number[] }[] }, id: string) =>
  esper.stats.find((stat) => stat.id_stats === id)!.values;

describe("base stats", () => {
  it("reproduces the measured level-50 HP for two different espers", () => {
    // Both must come out exact: the five-decimal multiplier floors Adler one
    // point low, which is what forced the band.
    // The multiplier is a property of the level, not the character: these two
    // agree to five decimals while their flat deltas differ by 120.
    expect(baseStat(curve(esperByName("Haniel"), "HPMaxBase"), 50, "HP")).toBe(8272);
    expect(baseStat(curve(esperByName("Adler"), "HPMaxBase"), 50, "HP")).toBe(8638);
  });

  it("reproduces Zankou's measured level-70 sheet", () => {
    const zankou = esperByName("Zankou");
    expect(baseStat(curve(zankou, "HPMaxBase"), 70, "HP")).toBe(13466);
    expect(baseStat(curve(zankou, "DefBase"), 70, "DEF")).toBe(789);
  });

  it("keeps ATK on a lower multiplier than HP and DEF", () => {
    // The level-50 bands do not overlap, so the split is real, not rounding.
    const atk = MULTIPLIER[50]!.ATK as { min: number; max: number };
    const hp = MULTIPLIER[50]!.HP as { min: number; max: number };
    expect(atk.max).toBeLessThan(hp.min);
  });

  it("reports level 80 as unmeasured rather than guessing", () => {
    expect(hasMultiplier(80)).toBe(false);
    expect(baseStat(curve(esperByName("Zankou"), "HPMaxBase"), 80, "HP")).toBeNull();
  });
});

describe("ATK formula", () => {
  it("scales the Arc's ATK with ATK% but not flat gear ATK", () => {
    expect(Math.floor(totalAtk(577, 570, 420, 0.125))).toBe(1710);
  });
});

describe("console trait", () => {
  it("is read from the data, not hardcoded", () => {
    const zankou = consoleTrait(esperByName("Zankou"))!;
    expect(zankou).toEqual({
      stat: "CritDamageBase",
      name: "CRIT DMG",
      per: 0.16,
      moduleCells: 3,
    });
  });

  it("is not always CRIT DMG and not always Type III", () => {
    const traits = gamedata.espers.map((esper: never) => consoleTrait(esper)!);
    const typeTwo = traits.filter((trait: { moduleCells: number }) => trait.moduleCells === 2);
    expect(typeTwo).toHaveLength(3);
    expect(new Set(traits.map((trait: { stat: string }) => trait.stat)).size).toBe(8);
  });

  it("counts only modules of the trait's own cell count", () => {
    const zankou = consoleTrait(esperByName("Zankou"))!;
    // Four Type III modules is the reading Zankou's sheet was solved against:
    // 0.50 base + 0.60 cartridge main + 0.26 substats + 4 x 0.16 = 2.00.
    const contribution = traitContribution(zankou, [
      "cell3_style1",
      "cell3_style2",
      "cell3_style3",
      "cell3_style4",
      "cell2_style1",
      "cell4_style1",
    ])!;
    expect(contribution.value).toBeCloseTo(0.64, 10);
    expect(BASE_CRIT_DAMAGE + 0.6 + 0.26 + contribution.value).toBeCloseTo(2.0, 10);
  });

  it("starts every character at 5% CRIT Rate and 50% CRIT DMG", () => {
    expect(BASE_CRIT_RATE).toBe(0.05);
    expect(BASE_CRIT_DAMAGE).toBe(0.5);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compareSheet, predictSheet } from "../src/domain/sheet.ts";
import { emptyVector, slotOf } from "../src/domain/statvec.ts";

const gamedata = JSON.parse(readFileSync("src/generated/gamedata.json", "utf8"));
const zankou = gamedata.espers.find((esper: { name: string }) => esper.name === "Zankou");

const line = (lines: ReturnType<typeof predictSheet>, key: string) =>
  lines.find((entry) => entry.key === key)!;

describe("predicted sheet", () => {
  it("reproduces the measured off-team CRIT numbers", () => {
    // Zankou off-team: 0.05 base + 0.24 Arc main + 0.30 gear = 0.59.
    const total = emptyVector();
    total[slotOf("CritBase")] = 0.54;
    total[slotOf("CritDamageBase")] = 1.5;
    const lines = predictSheet(zankou, 70, total);
    expect(line(lines, "crit").predicted).toBeCloseTo(0.59, 6);
    expect(line(lines, "critDamage").predicted).toBeCloseTo(2.0, 6);
  });

  it("reproduces her measured level-70 base HP with no gear", () => {
    const lines = predictSheet(zankou, 70, emptyVector());
    expect(line(lines, "hp").predicted).toBe(13466);
    expect(line(lines, "def").predicted).toBe(789);
  });

  it("scales the Arc's flat ATK with ATK% but not gear's", () => {
    const total = emptyVector();
    total[slotOf("AtkBase")] = 570;
    total[slotOf("AtkUp")] = 0.125;
    total[slotOf("AtkAdd")] = 420;
    // (577 + 570) * 1.125 + 420 = 1710.375
    expect(Math.floor(line(predictSheet(zankou, 70, total), "atk").predicted!)).toBe(1710);
  });

  it("refuses to guess where the model has never been measured", () => {
    // Level 80 is the level builds actually use, and the multiplier for it has
    // never been read. Saying so beats inventing a number.
    const lines = predictSheet(zankou, 80, emptyVector());
    expect(line(lines, "hp").predicted).toBeNull();
    expect(line(lines, "hp").unavailable).toContain("not measured at level 80");
    // Stats that do not depend on the multiplier still work.
    expect(line(lines, "crit").predicted).toBeCloseTo(0.05, 6);
  });

  it("says so when the character's level is unknown", () => {
    const lines = predictSheet(zankou, null, emptyVector());
    expect(line(lines, "atk").unavailable).toBe("character level unknown");
  });

  it("starts cycle intensity and charge efficiency at their bases", () => {
    const lines = predictSheet(zankou, 70, emptyVector());
    expect(line(lines, "cycle").predicted).toBe(100);
    expect(line(lines, "charge").predicted).toBe(1);
  });
});

describe("drift against a real sheet", () => {
  const lines = predictSheet(zankou, 70, emptyVector());

  it("reports no drift when the reading matches", () => {
    const compared = compareSheet(lines, { hp: 13466 });
    const hp = compared.find((entry) => entry.key === "hp")!;
    expect(hp.delta).toBe(0);
    expect(hp.drifted).toBe(false);
  });

  it("flags a gap larger than rounding", () => {
    const compared = compareSheet(lines, { hp: 13000 });
    expect(compared.find((entry) => entry.key === "hp")!.drifted).toBe(true);
  });

  it("tolerates a one-point difference from a truncated display", () => {
    const compared = compareSheet(lines, { hp: 13465 });
    expect(compared.find((entry) => entry.key === "hp")!.drifted).toBe(false);
  });

  it("compares a percentage on its own scale", () => {
    // 1.0 of tolerance would make every percentage look correct.
    const compared = compareSheet(lines, { crit: 0.2 });
    expect(compared.find((entry) => entry.key === "crit")!.drifted).toBe(true);
  });

  it("leaves a line alone when nothing was measured for it", () => {
    const compared = compareSheet(lines, {});
    expect(compared.every((entry) => entry.actual === null && !entry.drifted)).toBe(true);
  });
});

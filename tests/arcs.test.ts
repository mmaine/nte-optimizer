import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { arcContribution, arcControls, parseArcValue } from "../src/domain/arcs.ts";
import { describe as describeVector, slotOf } from "../src/domain/statvec.ts";
import type { GameData } from "../src/state/gamedata.ts";

const gamedata = JSON.parse(readFileSync("src/generated/gamedata.json", "utf8")) as GameData;
const arcById = (id: string) => gamedata.arcs.find((arc) => arc.id === id)!;
const effectsFor = (id: string) => gamedata.arcEffects[id];

describe("arc values", () => {
  it("reads a percent string as a fraction", () => {
    expect(parseArcValue("12%", true)).toBeCloseTo(0.12, 10);
    expect(parseArcValue("12%", false)).toBeCloseTo(0.12, 10);
    expect(parseArcValue(20, false)).toBe(20);
    expect(parseArcValue(20, true)).toBeCloseTo(0.2, 10);
    expect(parseArcValue(" ", false)).toBe(0);
  });
});

describe("arc contribution", () => {
  it("carries the arc's own stat line at the given level", () => {
    const arc = arcById("fork_vine");
    const low = arcContribution(arc, effectsFor("fork_vine"), {
      arcId: arc.id,
      level: 1,
      refinement: 1,
    });
    const high = arcContribution(arc, effectsFor("fork_vine"), {
      arcId: arc.id,
      level: 80,
      refinement: 1,
    });
    const atk = slotOf("AtkBase");
    expect(low.vector[atk]).toBe(21);
    expect(high.vector[atk]!).toBeGreaterThan(low.vector[atk]!);
  });

  it("keeps the arc's flat ATK out of gear's flat ATK slot", () => {
    // They share a unit but not a formula: the Arc's ATK scales with ATK%.
    const arc = arcById("fork_vine");
    const result = arcContribution(arc, effectsFor("fork_vine"), {
      arcId: arc.id,
      level: 80,
      refinement: 1,
    });
    expect(result.vector[slotOf("AtkAdd")]).toBe(0);
    expect(result.vector[slotOf("AtkBase")]).toBeGreaterThan(0);
  });

  it("leaves a toggle off by default and reports it as omitted", () => {
    // fork_vine's own stat line is already HPMaxUp, so the toggle stacks onto
    // the same slot: the assertion has to be on the delta, not the total.
    const arc = arcById("fork_vine");
    const slot = slotOf("HPMaxUp");
    const off = arcContribution(arc, effectsFor("fork_vine"), {
      arcId: arc.id,
      level: 80,
      refinement: 5,
    });
    expect(off.omitted.some((entry) => entry.why === "toggled off")).toBe(true);

    const on = arcContribution(arc, effectsFor("fork_vine"), {
      arcId: arc.id,
      level: 80,
      refinement: 5,
      toggles: { 0: true },
    });
    // Refinement 5 of "12%..20%" is 20%.
    expect(on.vector[slot]! - off.vector[slot]!).toBeCloseTo(0.2, 6);
  });

  it("scales a refinement with the chosen level of it", () => {
    const arc = arcById("fork_vine");
    const slot = slotOf("HPMaxUp");
    const base = arcContribution(arc, effectsFor("fork_vine"), {
      arcId: arc.id,
      level: 80,
      refinement: 1,
    });
    const first = arcContribution(arc, effectsFor("fork_vine"), {
      arcId: arc.id,
      level: 80,
      refinement: 1,
      toggles: { 0: true },
    });
    expect(first.vector[slot]! - base.vector[slot]!).toBeCloseTo(0.12, 6);
  });

  it("never scores a duration or an unmodellable effect", () => {
    // fork_appliance's only effect is named ability damage, not a sheet stat.
    const arc = arcById("fork_appliance");
    const result = arcContribution(arc, effectsFor("fork_appliance"), {
      arcId: arc.id,
      level: 80,
      refinement: 5,
      toggles: { 0: true },
    });
    expect(result.omitted.length).toBeGreaterThan(0);
    // Only the arc's own stat line contributed.
    const nonZero = Object.keys(describeVector(result.vector));
    expect(nonZero.every((stat) => stat === "AtkBase" || stat === "AtkUp")).toBe(true);
  });

  it("has a slot for every stat any arc can contribute", () => {
    const unknown = new Set<string>();
    for (const arc of gamedata.arcs) {
      const result = arcContribution(arc, effectsFor(arc.id), {
        arcId: arc.id,
        level: 80,
        refinement: 5,
        toggles: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [index, true] as const),
        ),
      });
      for (const stat of result.unknownStats) unknown.add(stat);
    }
    expect([...unknown]).toEqual([]);
  });

  it("offers a control only for effects that need one", () => {
    const controls = arcControls(arcById("fork_vine"), effectsFor("fork_vine"));
    expect(controls.map((control) => control.mode)).toEqual(["toggle"]);
    // The cooldown placeholder is not a control.
    expect(controls).toHaveLength(1);
  });
});

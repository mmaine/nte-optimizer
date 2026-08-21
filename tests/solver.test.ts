import { describe, expect, it } from "vitest";

import { buildPool, type ExportedItem } from "../src/domain/items.ts";
import { compile } from "../src/domain/scoring.ts";
import type { SetBonusTable } from "../src/domain/setbonus.ts";
import { emptyVector } from "../src/domain/statvec.ts";
import type { Tiling } from "../src/domain/tilings.ts";
import { solveSingle } from "../src/solver/single.ts";
import type { SolveProgress, SolveResult } from "../src/solver/protocol.ts";

const bonuses: SetBonusTable = {
  format: "nte-set-bonuses",
  format_version: 1,
  sets: {
    "Shadow Creed": { "2": { unknown: true, stats: [] }, "4": { unknown: true, stats: [] } },
  },
};

const scoring = compile({
  targets: [
    { stat: "CritBase", target: 0.2, weight: 1 },
    { stat: "CritDamageBase", target: 0.4, weight: 1 },
  ],
});

let counter = 0;
function module_(shape: string, crit: number, critDamage: number): ExportedItem {
  counter += 1;
  return {
    instance: `m${counter}`,
    kind: "module",
    item_id: `${shape}_1_Orange`,
    shape,
    level: 20,
    rarity: "orange",
    main_stats: [],
    substats: [
      { stat: "CritBase", value: crit },
      { stat: "CritDamageBase", value: critDamage },
    ],
    owner_group: null,
  };
}

function cartridge(mainStat: string, value: number): ExportedItem {
  counter += 1;
  return {
    instance: `c${counter}`,
    kind: "cartridge",
    item_id: "Attack_orange",
    set: "Shadow Creed",
    level: 20,
    rarity: "orange",
    main_stats: [{ stat: mainStat, value }],
    substats: [],
    owner_group: null,
  };
}

/** A packing needing two of one shape and one of another. */
const tiling = (pieces: string[]): Tiling =>
  ({ set: "Shadow Creed", pieces, cells: [], placement: [] }) as unknown as Tiling;

function run(request: Parameters<typeof solveSingle>[0]): {
  result: SolveResult;
  progress: SolveProgress[];
} {
  const generator = solveSingle(request);
  const progress: SolveProgress[] = [];
  let step = generator.next();
  while (!step.done) {
    progress.push(step.value);
    step = generator.next();
  }
  return { result: step.value, progress };
}

describe("single-character solve", () => {
  const items = [
    module_("cell2_style1", 0.02, 0.04),
    module_("cell2_style1", 0.06, 0.12), // clearly the best of its shape
    module_("cell2_style1", 0.03, 0.06),
    module_("cell3_style1", 0.01, 0.02),
    module_("cell3_style1", 0.05, 0.10), // and of its shape
    cartridge("CritDamageBase", 0.12),
  ];
  const pool = buildPool(items);
  const base = () => emptyVector();

  it("picks the best module of each shape", () => {
    const { result } = run({
      pool,
      tilings: [tiling(["cell2_style1", "cell3_style1"])],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    const best = result.best!;
    expect(best.modules.map((index) => pool.items[index]!.instance).sort()).toEqual(["m2", "m5"]);
    expect(best.proven).toBe(true);
  });

  it("never uses the same module twice", () => {
    const { result } = run({
      pool,
      tilings: [tiling(["cell2_style1", "cell2_style1", "cell3_style1"])],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    const best = result.best!;
    expect(best.modules).toHaveLength(3);
    expect(new Set(best.modules).size).toBe(3);
    // Two copies of a shape must take its two best, not its best twice.
    expect(best.modules.map((index) => pool.items[index]!.instance).sort()).toEqual([
      "m2",
      "m3",
      "m5",
    ]);
  });

  it("returns one module per piece in the packing", () => {
    for (const pieces of [
      ["cell2_style1", "cell3_style1"],
      ["cell2_style1", "cell2_style1", "cell3_style1"],
    ]) {
      const { result } = run({
        pool,
        tilings: [tiling(pieces)],
        base: base(),
        trait: null,
        setBonuses: bonuses,
        scoring,
      });
      expect(result.best!.modules).toHaveLength(pieces.length);
    }
  });

  it("respects items held by other characters", () => {
    const { result } = run({
      pool,
      tilings: [tiling(["cell2_style1", "cell3_style1"])],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
      excluded: new Set([1]), // m2, the best cell2
    });
    const chosen = result.best!.modules.map((index) => pool.items[index]!.instance);
    expect(chosen).not.toContain("m2");
    expect(chosen.sort()).toEqual(["m3", "m5"]);
  });

  it("reports a packing as unbuildable when no cartridge of its set is owned", () => {
    const moduleOnly = buildPool(items.filter((item) => item.kind === "module"));
    const { result } = run({
      pool: moduleOnly,
      tilings: [tiling(["cell2_style1", "cell3_style1"])],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    expect(result.unbuildable).toBe(true);
    expect(result.best).toBeNull();
  });

  it("skips a packing that needs more copies of a shape than exist", () => {
    const { result } = run({
      pool,
      tilings: [tiling(["cell3_style1", "cell3_style1", "cell3_style1"])],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    expect(result.best).toBeNull();
    // The packing was reachable, so this is "no build", not "no packing".
    expect(result.unbuildable).toBe(false);
  });

  it("yields progress with a real denominator and a usable best at every step", () => {
    const { result, progress } = run({
      pool,
      tilings: [
        tiling(["cell2_style1", "cell3_style1"]),
        tiling(["cell2_style1", "cell2_style1", "cell3_style1"]),
      ],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    expect(progress.length).toBeGreaterThan(0);
    for (const step of progress) {
      expect(step.total).toBe(2);
      expect(step.done).toBeLessThanOrEqual(step.total);
      // Anytime: any yielded best is already a complete, valid build.
      if (step.best) expect(step.best.modules.length).toBe(step.best.tiling.pieces.length);
    }
    expect(result.examined).toBe(2);
  });

  it("carries the unmeasured set tiers through to the build", () => {
    // Shadow Creed needs cell2_style1, cell2_style2, cell4_style1 and
    // cell4_style6; two of them present is the (2) bonus.
    const withRequired = buildPool([...items, module_("cell2_style2", 0.05, 0.1)]);
    const { result } = run({
      pool: withRequired,
      tilings: [tiling(["cell2_style1", "cell2_style2"])],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    // The tier is active and its value is unknown, which the build has to admit
    // rather than quietly scoring it as zero.
    expect(result.best!.unknownTiers).toEqual([2]);
  });

  it("reports no tier at all when the shapes do not qualify", () => {
    const { result } = run({
      pool,
      tilings: [tiling(["cell2_style1", "cell3_style1"])],
      base: base(),
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    // Only one of Shadow Creed's required shapes is on the board.
    expect(result.best!.unknownTiers).toEqual([]);
  });

  it("counts a character's own base contribution", () => {
    const withBase = emptyVector();
    withBase[6] = 0.2; // CritBase already at target
    const { result } = run({
      pool,
      tilings: [tiling(["cell2_style1", "cell3_style1"])],
      base: withBase,
      trait: null,
      setBonuses: bonuses,
      scoring,
    });
    expect(result.best!.score).toBeGreaterThan(0.5);
  });
});

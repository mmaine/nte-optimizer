import { describe, expect, it } from "vitest";

import { bitsetOf, disjoint, members, overlapCount } from "../src/solver/bitset.ts";
import { diversify, itemsOf, type Portfolio } from "../src/solver/portfolio.ts";
import { compareLeximin, solveTeam } from "../src/solver/team.ts";
import type { Build } from "../src/solver/protocol.ts";
import type { Tiling } from "../src/domain/tilings.ts";

const POOL = 64;

const tiling = { set: "Shadow Creed", pieces: [], cells: [], placement: [] } as unknown as Tiling;

function build(score: number, cartridge: number, modules: number[]): Build {
  return {
    cartridge,
    modules,
    tiling,
    score,
    vector: new Float32Array(0),
    proven: true,
    unknownTiers: [],
    omittedTiers: [],
  };
}

const portfolio = (key: string, builds: Build[]): Portfolio => ({
  key,
  entries: builds.map((b) => ({ build: b, items: itemsOf(b, POOL) })),
  unbuildable: false,
});

function run(request: Parameters<typeof solveTeam>[0]) {
  const generator = solveTeam(request);
  const progress = [];
  let step = generator.next();
  while (!step.done) {
    progress.push(step.value);
    step = generator.next();
  }
  return { result: step.value, progress };
}

describe("bitsets", () => {
  it("round-trips membership", () => {
    const set = bitsetOf(POOL, [0, 5, 33, 63]);
    expect(members(set)).toEqual([0, 5, 33, 63]);
  });

  it("detects sharing across word boundaries", () => {
    expect(disjoint(bitsetOf(POOL, [1, 2]), bitsetOf(POOL, [3, 4]))).toBe(true);
    expect(disjoint(bitsetOf(POOL, [1, 33]), bitsetOf(POOL, [33]))).toBe(false);
    expect(overlapCount(bitsetOf(POOL, [1, 33, 40]), bitsetOf(POOL, [33, 40, 50]))).toBe(2);
  });
});

describe("portfolio diversity", () => {
  it("prefers a spread over near-duplicates of the best build", () => {
    const builds = [
      build(1.0, 0, [1, 2, 3]),
      build(0.99, 0, [1, 2, 4]), // near-duplicate of the best
      build(0.9, 10, [11, 12, 13]), // shares nothing
    ];
    const kept = diversify(builds, POOL, 2);
    expect(kept.map((entry) => entry.build.score)).toEqual([1.0, 0.9]);
  });

  it("keeps everything when the portfolio is smaller than the cap", () => {
    const builds = [build(1.0, 0, [1]), build(0.5, 2, [3])];
    expect(diversify(builds, POOL, 10)).toHaveLength(2);
  });
});

describe("leximin comparison", () => {
  it("maximises the worst entry first", () => {
    expect(compareLeximin([0.9, 0.5], [0.8, 0.6])).toBeLessThan(0);
    expect(compareLeximin([0.7, 0.7], [0.9, 0.5])).toBeGreaterThan(0);
    expect(compareLeximin([0.6, 0.8], [0.8, 0.6])).toBe(0);
  });
});

describe("team solve", () => {
  it("never gives one character an item another is using", () => {
    const a = portfolio("A", [build(1.0, 0, [1, 2]), build(0.6, 10, [11, 12])]);
    const b = portfolio("B", [build(0.9, 0, [1, 2]), build(0.5, 20, [21, 22])]);
    const { result } = run({ portfolios: [a, b], poolSize: POOL });
    const used = result.assignment.flatMap((entry) => [
      entry.build.cartridge,
      ...entry.build.modules,
    ]);
    expect(new Set(used).size).toBe(used.length);
  });

  it("lifts the worst character rather than the total", () => {
    // Sum would pick 1.0 + 0.5 = 1.5; leximin picks 0.6 + 0.9 = 1.5 with a
    // much better floor.
    const a = portfolio("A", [build(1.0, 0, [1, 2]), build(0.6, 10, [11, 12])]);
    const b = portfolio("B", [build(0.9, 0, [1, 2]), build(0.5, 20, [21, 22])]);
    const { result } = run({ portfolios: [a, b], poolSize: POOL });
    expect(Math.min(...result.sorted)).toBeCloseTo(0.6, 6);
  });

  it("gives generation order no advantage", () => {
    const a = portfolio("A", [build(1.0, 0, [1, 2]), build(0.6, 10, [11, 12])]);
    const b = portfolio("B", [build(0.9, 0, [1, 2]), build(0.5, 20, [21, 22])]);
    const forward = run({ portfolios: [a, b], poolSize: POOL }).result;
    const backward = run({ portfolios: [b, a], poolSize: POOL }).result;
    expect(forward.sorted).toEqual(backward.sorted);
  });

  it("reports characters with no valid build instead of dropping them", () => {
    const a = portfolio("A", [build(1.0, 0, [1, 2])]);
    const none: Portfolio = { key: "B", entries: [], unbuildable: true };
    const { result } = run({ portfolios: [a, none], poolSize: POOL });
    expect(result.unbuildable).toEqual(["B"]);
    expect(result.assignment.map((entry) => entry.key)).toEqual(["A"]);
  });

  it("yields a complete, conflict-free assignment at every step", () => {
    const a = portfolio("A", [build(1.0, 0, [1, 2]), build(0.6, 10, [11, 12])]);
    const b = portfolio("B", [build(0.9, 0, [1, 2]), build(0.5, 20, [21, 22])]);
    const { progress } = run({ portfolios: [a, b], poolSize: POOL });
    expect(progress.length).toBeGreaterThan(0);
    for (const step of progress) {
      expect(step.assignment).toHaveLength(2);
      const used = step.assignment.flatMap((entry) => [
        entry.build.cartridge,
        ...entry.build.modules,
      ]);
      expect(new Set(used).size).toBe(used.length);
    }
  });

  it("uses drag order only to break a tie", () => {
    const a = portfolio("A", [build(0.8, 0, [1, 2])]);
    const b = portfolio("B", [build(0.8, 10, [11, 12])]);
    const { result } = run({ portfolios: [a, b], poolSize: POOL, dragOrder: ["B", "A"] });
    expect(result.assignment.map((entry) => entry.key)).toEqual(["B", "A"]);
    // The tie-break reorders the report; it does not change the outcome.
    expect(result.sorted).toEqual([0.8, 0.8]);
  });


  it("seeds a team when the portfolios share every item", () => {
    // Both characters only ever want the same three items, so no conflict-free
    // selection exists in the portfolios at all - the case that made a real
    // four-character solve return nothing.
    const a = portfolio("A", [build(1.0, 0, [1, 2])]);
    const b = portfolio("B", [build(0.9, 0, [1, 2])]);
    const withoutSeed = run({ portfolios: [a, b], poolSize: POOL }).result;
    expect(withoutSeed.infeasible).toBe(true);
    expect(withoutSeed.assignment).toEqual([]);

    const seeded = run({
      portfolios: [portfolio("A", [build(1.0, 0, [1, 2])]), portfolio("B", [build(0.9, 0, [1, 2])])],
      poolSize: POOL,
      resolve: (key, excluded) =>
        excluded.has(0) ? [build(0.4, 10, [11, 12])] : [build(0.9, 0, [1, 2])],
    }).result;
    expect(seeded.infeasible).toBe(false);
    expect(seeded.assignment).toHaveLength(2);
    const used = seeded.assignment.flatMap((e) => [e.build.cartridge, ...e.build.modules]);
    expect(new Set(used).size).toBe(used.length);
  });

  it("reports infeasible rather than an empty team when it cannot seed", () => {
    const a = portfolio("A", [build(1.0, 0, [1, 2])]);
    const b = portfolio("B", [build(0.9, 0, [1, 2])]);
    const { result } = run({ portfolios: [a, b], poolSize: POOL, resolve: () => [] });
    expect(result.infeasible).toBe(true);
    expect(result.unbuildable).toEqual([]);
  });

  it("improves the vector by column generation and stops when it cannot", () => {
    const a = portfolio("A", [build(1.0, 0, [1, 2])]);
    const b = portfolio("B", [build(0.2, 10, [11, 12])]);
    let calls = 0;
    const { result } = run({
      portfolios: [a, b],
      poolSize: POOL,
      resolve: (key) => {
        calls += 1;
        // A better, still conflict-free build turns up for the worst-off.
        return key === "B" && calls <= 2 ? [build(0.7, 30, [31, 32])] : [];
      },
    });
    expect(Math.min(...result.sorted)).toBeCloseTo(0.7, 6);
    expect(result.rounds).toBeGreaterThan(0);
  });
});

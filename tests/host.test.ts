import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ICON_ORDER } from "../src/domain/shapes.ts";
import type { SetBonusTable } from "../src/domain/setbonus.ts";
import { consoleTrait } from "../src/domain/stats.ts";
import { SLOT_COUNT } from "../src/domain/statvec.ts";
import type { RawTilings } from "../src/domain/tilings.ts";
import type { ExportedItem } from "../src/domain/items.ts";
import { runJob, type JobProgress, type SolveJob } from "../src/solver/job.ts";
import { CancelledError, createInlineHost, createSolverHost } from "../src/solver/host.ts";

const gamedata = JSON.parse(readFileSync("src/generated/gamedata.json", "utf8"));
const tilings = JSON.parse(readFileSync("src/generated/tilings.json", "utf8")) as RawTilings;
const setBonuses = JSON.parse(readFileSync("data-src/set-bonuses.json", "utf8")) as SetBonusTable;

/**
 * A synthetic account: plenty of every shape, and cartridges of one set. Real
 * game data for the boards and packings, invented inventory - the fixture policy
 * keeps real captures out of the repo.
 */
function account(): ExportedItem[] {
  const items: ExportedItem[] = [];
  let n = 0;
  for (const shape of ICON_ORDER) {
    for (let i = 0; i < 8; i += 1) {
      n += 1;
      items.push({
        instance: `m${n}`,
        kind: "module",
        item_id: `${shape}_1_Orange`,
        shape,
        level: 20,
        rarity: "orange",
        main_stats: [],
        substats: [
          { stat: "CritBase", value: 0.01 * (i + 1) },
          { stat: "CritDamageBase", value: 0.02 * (i + 1) },
        ],
        owner_group: null,
      });
    }
  }
  for (let i = 0; i < 6; i += 1) {
    n += 1;
    items.push({
      instance: `c${n}`,
      kind: "cartridge",
      item_id: "Attack_orange",
      set: "Shadow Creed",
      level: 20,
      rarity: "orange",
      main_stats: [{ stat: "CritDamageBase", value: 0.6 }],
      substats: [{ stat: "CritBase", value: 0.01 * (i + 1) }],
      owner_group: null,
    });
  }
  return items;
}

function job(keys: string[]): SolveJob {
  return {
    items: account(),
    setBonuses,
    tilings,
    characters: keys.map((name) => {
      const esper = gamedata.espers.find((e: { name: string }) => e.name === name);
      return {
        key: name,
        slots: esper.slots,
        trait: consoleTrait(esper),
        base: new Array(SLOT_COUNT).fill(0),
        scoring: {
          targets: [
            { stat: "CritBase" as const, target: 0.7, weight: 3 },
            { stat: "CritDamageBase" as const, target: 2.0, weight: 3 },
          ],
        },
        sets: ["Shadow Creed" as const],
      };
    }),
    options: { rounds: 1 },
  };
}

describe("runJob", () => {
  it("solves one character end to end from a serialisable job", () => {
    const run = runJob(job(["Zankou"]));
    const progress: JobProgress[] = [];
    let step = run.next();
    while (!step.done) {
      progress.push(step.value);
      step = run.next();
    }
    const result = step.value;
    expect(result.infeasible).toBe(false);
    expect(result.assignment).toHaveLength(1);
    expect(result.unbuildable).toEqual([]);
    expect(result.unknownShapes).toEqual([]);
    expect(progress.some((p) => p.phase === "portfolio")).toBe(true);
    expect(progress.some((p) => p.phase === "team")).toBe(true);
  });

  it("carries selected set tiers through the job boundary", () => {
    const twoPiece = job(["Zankou"]);
    twoPiece.characters[0]!.targetTier = 2;
    const runTwo = runJob(twoPiece);
    let step = runTwo.next();
    while (!step.done) step = runTwo.next();
    expect(step.value.assignment[0]!.build.omittedTiers).toEqual([]);

    const full = job(["Zankou"]);
    full.characters[0]!.targetTier = 4;
    const runFull = runJob(full);
    let next = runFull.next();
    while (!next.done) next = runFull.next();
    expect(next.value.assignment[0]!.build.omittedTiers[0]).toMatchObject({ tier: 4, mode: "duration" });
  });

  it("gives two characters disjoint items", () => {
    const run = runJob(job(["Zankou", "Haniel"]));
    let step = run.next();
    while (!step.done) step = run.next();
    const used = step.value.assignment.flatMap((entry) => [
      entry.build.cartridge,
      ...entry.build.modules,
    ]);
    expect(step.value.assignment).toHaveLength(2);
    expect(new Set(used).size).toBe(used.length);
  });


  it("honours a character's excluded instances", () => {
    // R2 turned off: whatever another character wears is off limits, and the
    // solve must actually avoid it rather than merely be told about it.
    const plain = runJob(job(["Zankou"]));
    let step = plain.next();
    while (!step.done) step = plain.next();
    const chosen = step.value.assignment[0]!.build;
    const pool = job(["Zankou"]).items;
    const used = [chosen.cartridge, ...chosen.modules].map((index) => pool[index]!.instance);
    expect(used.length).toBeGreaterThan(0);

    const restricted = job(["Zankou"]);
    restricted.characters[0]!.excludedInstances = used;
    const run = runJob(restricted);
    let next = run.next();
    while (!next.done) next = run.next();
    const after = next.value.assignment[0]!.build;
    const afterInstances = [after.cartridge, ...after.modules].map(
      (index) => restricted.items[index]!.instance,
    );
    for (const instance of used) expect(afterInstances).not.toContain(instance);
  });

  it("carries a job with no packings through as unbuildable", () => {
    const empty = job(["Zankou"]);
    empty.characters[0]!.sets = ["Kingdom's Guard"]; // owned by nobody here
    const run = runJob(empty);
    let step = run.next();
    while (!step.done) step = run.next();
    expect(step.value.unbuildable).toEqual(["Zankou"]);
    expect(step.value.assignment).toEqual([]);
  });

  it("reports item ids it has no shape for instead of dropping them", () => {
    const odd = job(["Zankou"]);
    odd.items.push({
      instance: "x1",
      kind: "module",
      item_id: "cell9_style9_1_Orange",
      shape: "cell9_style9",
      level: 0,
      rarity: "orange",
      main_stats: [],
      substats: [],
      owner_group: null,
    });
    const run = runJob(odd);
    let step = run.next();
    while (!step.done) step = run.next();
    expect(step.value.unknownShapes).toEqual(["cell9_style9_1_Orange"]);
  });
});

describe("solver host", () => {
  it("falls back to inline where there is no Worker", () => {
    // Node has none, which is also the file:// build's situation.
    expect(createSolverHost().kind).toBe("inline");
  });

  it("resolves with the same answer the generator gives", async () => {
    const host = createInlineHost();
    const direct = runJob(job(["Zankou"]));
    let step = direct.next();
    while (!step.done) step = direct.next();

    const seen: JobProgress[] = [];
    const handle = host.solve(job(["Zankou"]), (progress) => seen.push(progress));
    const result = await handle.promise;
    expect(result.sorted).toEqual(step.value.sorted);
    expect(seen.length).toBeGreaterThan(0);
    host.dispose();
  });

  it("cancels cooperatively", async () => {
    const host = createInlineHost();
    const handle = host.solve(job(["Zankou", "Haniel"]));
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(CancelledError);
    host.dispose();
  });
});

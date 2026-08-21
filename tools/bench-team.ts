/**
 * Times a four-character team solve against a real export.
 *
 *   node --experimental-strip-types tools/bench-team.ts path/to/gear.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { boardFromSlots, boardKey } from "../src/domain/board.ts";
import { buildPool, type ExportedItem } from "../src/domain/items.ts";
import { compile } from "../src/domain/scoring.ts";
import type { SetBonusTable } from "../src/domain/setbonus.ts";
import { consoleTrait } from "../src/domain/stats.ts";
import { emptyVector } from "../src/domain/statvec.ts";
import { loadTilings, type RawTilings } from "../src/domain/tilings.ts";
import { diversify, type Portfolio } from "../src/solver/portfolio.ts";
import { solveSingle } from "../src/solver/single.ts";
import { solveTeam } from "../src/solver/team.ts";
import type { Build } from "../src/solver/protocol.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gear = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const gamedata = JSON.parse(readFileSync(join(root, "src/generated/gamedata.json"), "utf8"));
const setBonuses = JSON.parse(
  readFileSync(join(root, "data-src/set-bonuses.json"), "utf8"),
) as SetBonusTable;
const tables = loadTilings(
  JSON.parse(readFileSync(join(root, "src/generated/tilings.json"), "utf8")) as RawTilings,
);

const pool = buildPool(gear.items as ExportedItem[]);
const scoring = compile({
  targets: [
    { stat: "CritBase", target: 0.7, weight: 3 },
    { stat: "CritDamageBase", target: 2.0, weight: 3 },
    { stat: "AtkUp", target: 0.5, weight: 2 },
    { stat: "UnbalIntensityBase", target: 280, weight: 1 },
  ],
  mainStatRank: { CritDamageBase: 1, AtkUp: 0.5 },
});

const team = ["Zankou", "Haniel", "Adler", "Nanally"];
const espers = team.map((name) =>
  gamedata.espers.find((esper: { name: string }) => esper.name === name),
);

/** Every packing the character's board allows, across every set it owns. */
function tilingsFor(esper: { slots: number[][] }) {
  const key = boardKey(boardFromSlots(esper.slots));
  const table = tables.find((entry) => entry.cells.join(",") === key)!;
  return [...table.bySet.values()].flat();
}

function solveOne(index: number, excluded: ReadonlySet<number>): Build[] {
  const run = solveSingle({
    pool,
    tilings: tilingsFor(espers[index]),
    base: emptyVector(),
    trait: consoleTrait(espers[index]),
    setBonuses,
    scoring,
    excluded,
    beamWidth: 60,
    candidateWidth: 12,
  });
  let step = run.next();
  while (!step.done) step = run.next();
  return step.value.portfolio;
}

console.log(`pool ${pool.items.length} items, team ${team.join(", ")}\n`);

const phase0 = Date.now();
const portfolios: Portfolio[] = espers.map((esper, index) => {
  const started = Date.now();
  const builds = solveOne(index, new Set());
  const entries = diversify(builds, pool.items.length, 300);
  console.log(
    `  ${team[index]!.padEnd(9)} ${tilingsFor(esper).length} packings, ` +
      `${builds.length} builds -> ${entries.length} kept, ` +
      `best ${entries[0]?.build.score.toFixed(4) ?? "none"}, ${Date.now() - started} ms`,
  );
  return { key: team[index]!, entries, unbuildable: entries.length === 0 };
});
console.log(`phase 0 total ${Date.now() - phase0} ms\n`);

const phase12 = Date.now();
const run = solveTeam({
  portfolios,
  poolSize: pool.items.length,
  dragOrder: team,
  resolve: (key, excluded) => solveOne(team.indexOf(key), excluded).slice(0, 40),
  rounds: 6,
});
let step = run.next();
let yields = 0;
while (!step.done) {
  yields += 1;
  console.log(
    `  round ${step.value.round}: [${step.value.sorted.map((s) => s.toFixed(4)).join(", ")}]`,
  );
  step = run.next();
}
const result = step.value;
console.log(`\ninfeasible=${result.infeasible}`);
console.log(`phases 1+2 ${Date.now() - phase12} ms, ${yields} yields, ${result.rounds} rounds`);
console.log(`final sorted [${result.sorted.map((s) => s.toFixed(4)).join(", ")}]`);
for (const entry of result.assignment) {
  console.log(
    `  ${entry.key.padEnd(9)} ${entry.build.score.toFixed(4)} ` +
      `${pool.items[entry.build.cartridge]!.itemId} + ${entry.build.modules.length} modules`,
  );
}
const used = result.assignment.flatMap((e) => [e.build.cartridge, ...e.build.modules]);
console.log(`items used ${used.length}, distinct ${new Set(used).size}`);

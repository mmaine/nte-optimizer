/**
 * Times a real solve against a real export. Not a test - the fixture policy
 * keeps real captures out of the repo, so this takes the export path as an
 * argument and is run by hand.
 *
 *   node --experimental-strip-types tools/bench-solve.ts path/to/gear.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

import { buildPool, type ExportedItem } from "../src/domain/items.ts";
import { compile, explain } from "../src/domain/scoring.ts";
import { consoleTrait } from "../src/domain/stats.ts";
import { loadTilings, type RawTilings } from "../src/domain/tilings.ts";
import { boardFromSlots, boardKey } from "../src/domain/board.ts";
import { emptyVector } from "../src/domain/statvec.ts";
import type { SetBonusTable } from "../src/domain/setbonus.ts";
import { solveSingle } from "../src/solver/single.ts";

const exportPath = process.argv[2]!;
const gear = JSON.parse(readFileSync(exportPath, "utf8"));
const gamedata = JSON.parse(readFileSync(join(root, "src/generated/gamedata.json"), "utf8"));
const setBonuses = JSON.parse(readFileSync(join(root, "data-src/set-bonuses.json"), "utf8")) as SetBonusTable;
const tables = loadTilings(JSON.parse(readFileSync(join(root, "src/generated/tilings.json"), "utf8")) as RawTilings);

const pool = buildPool(gear.items as ExportedItem[]);
console.log(
  `pool: ${pool.items.length} items, ${pool.modulesByShape.size} shapes, ` +
    `${pool.cartridgesBySet.size} sets owned, unknown shapes: ${pool.unknownShapes.length}`,
);

const zankou = gamedata.espers.find((e: { name: string }) => e.name === "Zankou");
const board = boardFromSlots(zankou.slots);
const table = tables.find((t) => t.cells.join(",") === boardKey(board))!;

const scoring = compile({
  targets: [
    { stat: "CritBase", target: 0.7, weight: 3 },
    { stat: "CritDamageBase", target: 2.0, weight: 3 },
    { stat: "AtkUp", target: 0.5, weight: 2 },
    { stat: "UnbalIntensityBase", target: 280, weight: 1 },
  ],
  mainStatRank: { CritDamageBase: 1, AtkUp: 0.5 },
});

for (const set of ["Crimson: Twin Butterflies", "Shadow Creed"] as const) {
  const tilings = table.bySet.get(set) ?? [];
  const started = Date.now();
  const run = solveSingle({
    pool,
    tilings,
    base: emptyVector(),
    trait: consoleTrait(zankou),
    setBonuses,
    scoring,
  });
  let step = run.next();
  let yields = 0;
  while (!step.done) {
    yields += 1;
    step = run.next();
  }
  const result = step.value;
  const elapsed = Date.now() - started;
  const best = result.best;
  console.log(
    `\n${set}: ${tilings.length} packings, examined ${result.examined}, ` +
      `${yields} yields, ${elapsed} ms`,
  );
  if (!best) {
    console.log("  no build");
    continue;
  }
  console.log(
    `  score ${best.score.toFixed(5)} proven=${best.proven} ` +
      `pieces=${best.modules.length} unknownTiers=[${best.unknownTiers}]`,
  );
  console.log(`  cartridge ${pool.items[best.cartridge]!.itemId} main ${pool.items[best.cartridge]!.mainStat}`);
  console.log(`  modules ${best.modules.map((i) => pool.items[i]!.shape).join(" ")}`);
  const report = explain(best.vector, scoring);
  for (const stat of report.stats) {
    console.log(
      `    ${stat.stat.padEnd(20)} ${stat.value.toFixed(3).padStart(9)} / ${String(stat.target).padStart(6)}` +
        `  ${(stat.attainment * 100).toFixed(1)}%`,
    );
  }
  console.log(`  distinct modules used: ${new Set(best.modules).size}/${best.modules.length}`);
}

/**
 * Precomputes every (board, set, filler) packing, so exact cover never runs at
 * runtime.
 *
 * Positions do not affect score, so one canonical placement per shape multiset
 * is all the app ever needs - for rendering. What the solver actually consumes
 * is the list of multisets that tile at all.
 *
 * Output src/generated/tilings.json (committed, bundled).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { boardFromSlots, boardKey, fillers, tile, type Board } from "../src/domain/board.ts";
import { REQUIRED_PIECES, SET_NAMES } from "../src/domain/cartridges.ts";
import { ICON_ORDER, type ShapeId } from "../src/domain/shapes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gamedata = JSON.parse(
  readFileSync(join(root, "src", "generated", "gamedata.json"), "utf8"),
);

// Characters sharing a grid share a tiling table; there are only a few distinct
// grids across the whole roster.
const boards = new Map<string, { board: Board; espers: string[] }>();
for (const esper of gamedata.espers) {
  const board = boardFromSlots(esper.slots);
  const key = boardKey(board);
  const entry = boards.get(key);
  if (entry) entry.espers.push(esper.abilityKey);
  else boards.set(key, { board, espers: [esper.abilityKey] });
}

const boardList = [...boards.values()];
const freeCells = new Set(boardList.map((entry) => entry.board.cells.length));
if (freeCells.size !== 1) {
  throw new Error(`boards disagree on free cell count: ${[...freeCells].join(", ")}`);
}
const cellCount = [...freeCells][0]!;

const REQUIRED_CELLS = 12;
const fillerSets = fillers(cellCount - REQUIRED_CELLS);

/**
 * Entries are encoded rather than spelled out: 1,297 packings of 20 cells is
 * 350 KB as plain arrays and 50 KB like this, and the app decodes one entry
 * only when it draws a board.
 *
 *   [setIndex, pieces, placement]
 *     pieces     one base36 digit per piece - an index into ICON_ORDER
 *     placement  one base36 digit per board cell, in `cells` order - an index
 *                into `pieces`
 */
type Entry = [set: number, pieces: string, placement: string];

const base36 = (value: number): string => {
  if (value >= 36) throw new Error(`index ${value} does not fit one base36 digit`);
  return value.toString(36);
};

const tables: Array<{ cells: number[]; espers: string[]; entries: Entry[] }> = [];
let attempted = 0;
let tiled = 0;
const pieceCounts = new Map<number, number>();

for (const { board, espers } of boardList) {
  const entries: Entry[] = [];
  const cellIndex = new Map(board.cells.map((cell, index) => [cell, index]));
  for (const [setIndex, set] of SET_NAMES.entries()) {
    const required = REQUIRED_PIECES[set] as readonly ShapeId[];
    if (required.reduce((sum, shape) => sum + Number(shape.slice(4, 5)), 0) !== REQUIRED_CELLS) {
      throw new Error(`${set} does not total ${REQUIRED_CELLS} cells`);
    }
    for (const filler of fillerSets) {
      attempted += 1;
      const multiset = [...required, ...filler];
      const packed = tile(board, multiset);
      if (!packed) continue;
      tiled += 1;
      pieceCounts.set(multiset.length, (pieceCounts.get(multiset.length) ?? 0) + 1);

      const pieces = packed.map((piece) => base36(ICON_ORDER.indexOf(piece.shape))).join("");
      const placement = new Array<string>(board.cells.length);
      packed.forEach((piece, index) => {
        for (const cell of piece.cells) placement[cellIndex.get(cell)!] = base36(index);
      });
      if (placement.some((slot) => slot === undefined)) {
        throw new Error(`packing left a cell uncovered for ${set}`);
      }
      entries.push([setIndex, pieces, placement.join("")]);
    }
  }
  tables.push({ cells: [...board.cells], espers, entries });
}

const out = {
  format: "nte-tilings",
  format_version: 1,
  gridSize: 7,
  cellCount,
  shapes: ICON_ORDER,
  sets: SET_NAMES,
  boards: tables,
};
const json = JSON.stringify(out);
writeFileSync(join(root, "src", "generated", "tilings.json"), json + "\n");

const byPieces = [...pieceCounts.entries()].sort((a, b) => a[0] - b[0]);
console.log(
  `tilings.json  ${boardList.length} boards x ${SET_NAMES.length} sets x ` +
    `${fillerSets.length} fillers = ${attempted} combinations, ${tiled} tile  ` +
    `(${byPieces.map(([n, count]) => `${n} pieces: ${count}`).join(", ")})  ` +
    `${(json.length / 1024).toFixed(0)} KB`,
);

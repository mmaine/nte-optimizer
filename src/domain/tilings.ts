/**
 * Reads the precomputed packing table.
 *
 * Exact cover never runs in the app: `tools/precompute-tilings.ts` solved every
 * (board, set, filler) combination offline. What survives is which shape
 * multisets tile a board with a given set, plus one canonical placement each
 * for drawing.
 */
import type { SetName } from "./cartridges.ts";
import type { ShapeId } from "./shapes.ts";

type RawEntry = [set: number, pieces: string, placement: string];

interface RawBoard {
  cells: number[];
  espers: string[];
  entries: RawEntry[];
}

export interface RawTilings {
  format: string;
  format_version: number;
  gridSize: number;
  cellCount: number;
  shapes: ShapeId[];
  sets: SetName[];
  boards: RawBoard[];
}

export interface Tiling {
  set: SetName;
  /** In packing order, so `placement` indexes straight into it. */
  pieces: ShapeId[];
  /** Board cells, ascending. */
  cells: number[];
  /** `placement[i]` is the piece covering `cells[i]`. */
  placement: number[];
}

export interface BoardTilings {
  cells: number[];
  espers: string[];
  /** Every packing, grouped by cartridge set. */
  bySet: Map<SetName, Tiling[]>;
}

const digit = (char: string): number => parseInt(char, 36);

export function loadTilings(raw: RawTilings): BoardTilings[] {
  return raw.boards.map((board) => {
    const bySet = new Map<SetName, Tiling[]>();
    for (const [setIndex, pieces, placement] of board.entries) {
      const set = raw.sets[setIndex]!;
      const tiling: Tiling = {
        set,
        pieces: [...pieces].map((char) => raw.shapes[digit(char)]!),
        cells: board.cells,
        placement: [...placement].map(digit),
      };
      const list = bySet.get(set);
      if (list) list.push(tiling);
      else bySet.set(set, [tiling]);
    }
    return { cells: board.cells, espers: board.espers, bySet };
  });
}

/** The shape multiset of a packing, as counts keyed by shape. */
export function multisetOf(tiling: Tiling): Map<ShapeId, number> {
  const counts = new Map<ShapeId, number>();
  for (const shape of tiling.pieces) counts.set(shape, (counts.get(shape) ?? 0) + 1);
  return counts;
}

/** Cells covered by piece `index`, as board cell ids. */
export function cellsOfPiece(tiling: Tiling, index: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < tiling.placement.length; i += 1) {
    if (tiling.placement[i] === index) out.push(tiling.cells[i]!);
  }
  return out;
}

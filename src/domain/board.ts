/**
 * Board geometry and packing.
 *
 * A board is the character's console grid: everness ships it as a 7x7 matrix
 * with -1 blocked and 0 free. Every character's grid has 20 free cells.
 *
 * Positions never affect score - only the shape multiset does, via set tier and
 * console trait - so packing is decided once, offline, and the runtime only
 * ever looks up one canonical placement per multiset for rendering.
 */
import { SHAPES, SHAPE_IDS, sizeOf, type Cell, type ShapeId } from "./shapes.ts";

export type BoardCells = readonly number[];
export interface Board {
  /** Free cells as row * 7 + col, ascending. */
  cells: BoardCells;
  rows: number;
  cols: number;
}

export const GRID = 7;

export function boardFromSlots(slots: readonly (readonly number[])[]): Board {
  const cells: number[] = [];
  for (let row = 0; row < slots.length; row += 1) {
    const line = slots[row]!;
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === 0) cells.push(row * GRID + col);
    }
  }
  return { cells, rows: slots.length, cols: slots[0]?.length ?? GRID };
}

/** A stable identity for a board, so identical grids share one tiling table. */
export function boardKey(board: Board): string {
  return board.cells.join(",");
}

/** Every translation of a shape that lands entirely on the board. */
export function placements(shape: ShapeId, board: Board): number[][] {
  const free = new Set(board.cells);
  const offsets = SHAPES[shape] as readonly Cell[];
  const out: number[][] = [];
  for (let dr = 0; dr < board.rows; dr += 1) {
    for (let dc = 0; dc < board.cols; dc += 1) {
      const placed: number[] = [];
      let ok = true;
      for (const [r, c] of offsets) {
        const row = r + dr;
        const col = c + dc;
        if (col >= GRID) { ok = false; break; }
        const index = row * GRID + col;
        if (!free.has(index)) { ok = false; break; }
        placed.push(index);
      }
      if (ok) out.push(placed.sort((a, b) => a - b));
    }
  }
  return out;
}

export interface Placement {
  shape: ShapeId;
  cells: number[];
}

/**
 * Exact-cover the board with the given shapes, or null.
 *
 * Always fills the lowest free cell next, so the search never explores two
 * orderings of the same placement set.
 */
export function tile(board: Board, multiset: readonly ShapeId[]): Placement[] | null {
  const ordered = [...multiset].sort();
  const options = new Map<ShapeId, number[][]>();
  for (const shape of new Set(ordered)) options.set(shape, placements(shape, board));

  const free = new Set(board.cells);
  const order = [...board.cells];
  const placed: Placement[] = [];

  const solve = (remaining: readonly ShapeId[]): boolean => {
    if (remaining.length === 0) return free.size === 0;
    const target = order.find((cell) => free.has(cell));
    if (target === undefined) return false;
    for (let i = 0; i < remaining.length; i += 1) {
      const shape = remaining[i]!;
      // Identical shapes are interchangeable; trying the second is wasted work.
      if (i > 0 && shape === remaining[i - 1]) continue;
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      for (const spot of options.get(shape)!) {
        if (!spot.includes(target)) continue;
        let fits = true;
        for (const cell of spot) {
          if (!free.has(cell)) { fits = false; break; }
        }
        if (!fits) continue;
        for (const cell of spot) free.delete(cell);
        placed.push({ shape, cells: spot });
        if (solve(rest)) return true;
        placed.pop();
        for (const cell of spot) free.add(cell);
      }
    }
    return false;
  };

  return solve(ordered) ? placed : null;
}

/**
 * Shape multisets whose cells total exactly `freeCells`.
 *
 * Sizes are 2, 3 and 4, so a multiset covering 8 cells holds 2 to 4 pieces -
 * which is why a full build is 6, 7 or 8 modules and never always 7.
 */
export function fillers(freeCells: number): ShapeId[][] {
  const found: ShapeId[][] = [];
  const walk = (start: number, left: number, current: ShapeId[]): void => {
    if (left === 0) { found.push([...current]); return; }
    for (let i = start; i < SHAPE_IDS.length; i += 1) {
      const shape = SHAPE_IDS[i]!;
      const size = sizeOf(shape);
      if (size > left) continue;
      current.push(shape);
      walk(i, left - size, current);
      current.pop();
    }
  };
  walk(0, freeCells, []);
  return found;
}

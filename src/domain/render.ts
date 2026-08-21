/**
 * Turning a packing into something drawable.
 *
 * The result view has to read as blocks, not as a grid of squares: borders are
 * drawn only on the edges facing a *different* piece, so each polyomino looks
 * like one object rather than three or four cells that happen to share a colour.
 * That is the whole point of the visual - the player looks at a block, reads its
 * stats, and finds the matching module in their own inventory list.
 */
import { GRID } from "./board.ts";

export interface RenderedCell {
  cell: number;
  row: number;
  col: number;
  /** Index of the piece covering this cell, or -1 for a free board cell. */
  piece: number;
  /** Draw a border on this side: the neighbour is a different piece or off-board. */
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface BoardRender {
  cells: RenderedCell[];
  rows: number;
  cols: number;
}

/**
 * `cells` are the board's free cells ascending; `placement[i]` is the piece
 * covering `cells[i]`, matching `Tiling`.
 */
export function renderBoard(
  cells: readonly number[],
  placement: readonly number[],
): BoardRender {
  const pieceAt = new Map<number, number>();
  cells.forEach((cell, index) => pieceAt.set(cell, placement[index] ?? -1));

  const samePiece = (cell: number, deltaRow: number, deltaCol: number): boolean => {
    const row = Math.floor(cell / GRID) + deltaRow;
    const col = (cell % GRID) + deltaCol;
    // A move off the grid is not a neighbour, so that side always gets a border.
    if (row < 0 || row >= GRID || col < 0 || col >= GRID) return false;
    const neighbour = pieceAt.get(row * GRID + col);
    return neighbour !== undefined && neighbour === pieceAt.get(cell);
  };

  const rendered = cells.map((cell, index) => ({
    cell,
    row: Math.floor(cell / GRID),
    col: cell % GRID,
    piece: placement[index] ?? -1,
    top: !samePiece(cell, -1, 0),
    right: !samePiece(cell, 0, 1),
    bottom: !samePiece(cell, 1, 0),
    left: !samePiece(cell, 0, -1),
  }));

  return { cells: rendered, rows: GRID, cols: GRID };
}

/**
 * Distinct hues per piece, evenly spaced round the wheel.
 *
 * A build is 6 to 8 pieces, so an even split keeps neighbours far apart in hue
 * without needing a hand-tuned palette that would break as soon as a build had
 * one more piece than the palette had entries.
 */
export function pieceColour(piece: number, total: number): string {
  if (piece < 0) return "transparent";
  const hue = Math.round((360 / Math.max(total, 1)) * piece);
  return `hsl(${hue} 62% 55%)`;
}

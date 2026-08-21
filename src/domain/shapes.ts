/**
 * Module polyomino geometry, keyed by the id the packets carry.
 *
 * This is the complete shape set: 12 shapes, every one the game currently makes
 * obtainable. The gap at cell4_style3/style4 is dead id space, not missing
 * inventory - Type IV has four shapes and no more.
 *
 * Orientation is part of the item, not a placement choice: the horizontal and
 * vertical dominoes are separate ids, as are the horizontal and vertical
 * I-pieces. Modules therefore cannot be rotated when placed, and packing is
 * translation-only.
 *
 * Cells are [row, col] with the origin at the shape's top-left corner.
 */

export type Cell = readonly [row: number, col: number];
export type ShapeId = keyof typeof SHAPES;

export const SHAPES = {
  cell2_style1: [[0, 0], [0, 1]],
  cell2_style2: [[0, 0], [1, 0]],

  cell3_style1: [[0, 0], [0, 1], [0, 2]],
  cell3_style2: [[0, 0], [1, 0], [2, 0]],
  // The four L-trominoes are the four rotations of the same piece.
  cell3_style3: [[0, 0], [1, 0], [1, 1]],
  cell3_style4: [[0, 0], [0, 1], [1, 0]],
  cell3_style5: [[0, 0], [0, 1], [1, 1]],
  cell3_style6: [[0, 1], [1, 0], [1, 1]],

  cell4_style1: [[0, 0], [0, 1], [0, 2], [0, 3]],
  cell4_style2: [[0, 0], [1, 0], [2, 0], [3, 0]],
  // These two are mirror images - an S and a Z - not one piece in two
  // orientations. Rotating style5 gives 10/11/01, which is not style6, so the
  // available orientations are an arbitrary subset per piece and cannot be
  // generated.
  cell4_style5: [[0, 1], [0, 2], [1, 0], [1, 1]],
  cell4_style6: [[0, 1], [1, 0], [1, 1], [2, 0]],
} as const satisfies Record<string, readonly Cell[]>;

/** The order the in-game icons and Prydwen's `module_N.webp` use. */
export const ICON_ORDER = [
  "cell2_style1",
  "cell2_style2",
  "cell3_style1",
  "cell3_style2",
  "cell3_style3",
  "cell3_style4",
  "cell3_style5",
  "cell3_style6",
  "cell4_style1",
  "cell4_style2",
  "cell4_style5",
  "cell4_style6",
] as const satisfies readonly ShapeId[];

export const SHAPE_IDS = ICON_ORDER;

export function cellsOf(shape: ShapeId): readonly Cell[] {
  return SHAPES[shape];
}

export function sizeOf(shape: ShapeId): number {
  return SHAPES[shape].length;
}

/** 2, 3 or 4 - the module type, straight off the id. */
export function moduleCells(shape: ShapeId): number {
  return Number(shape.slice(4, 5));
}

export function extentOf(shape: ShapeId): { rows: number; cols: number } {
  const cells = SHAPES[shape];
  let rows = 0;
  let cols = 0;
  for (const [row, col] of cells) {
    if (row + 1 > rows) rows = row + 1;
    if (col + 1 > cols) cols = col + 1;
  }
  return { rows, cols };
}

/** Rows of '1' and '0', for eyeballing and for test failure messages. */
export function renderShape(shape: ShapeId): string[] {
  const { rows, cols } = extentOf(shape);
  const filled = new Set(SHAPES[shape].map(([r, c]) => r * cols + c));
  const out: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let line = "";
    for (let col = 0; col < cols; col += 1) {
      line += filled.has(row * cols + col) ? "1" : "0";
    }
    out.push(line);
  }
  return out;
}

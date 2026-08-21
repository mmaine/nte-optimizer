/**
 * A module's shape, drawn rather than named.
 *
 * `cell3_style4` tells a player nothing; the outline of the piece is what they
 * match against their inventory. Drawn from the same cell lists the solver
 * packs with, so an icon cannot drift from the geometry it stands for.
 */
import { cellsOf, extentOf, SHAPES, type ShapeId } from "../domain/shapes.ts";

function isShapeId(shape: string): shape is ShapeId {
  return Object.hasOwn(SHAPES, shape);
}

export function ShapeIcon({
  shape,
  size = 6,
  colour = "currentColor",
  title,
}: {
  shape: string | null | undefined;
  /** Pixels per cell. */
  size?: number;
  colour?: string;
  title?: string | undefined;
}) {
  if (!shape) return null;
  // An unknown id means the decoder produced a shape this build does not know:
  // show it raw rather than drawing something that is not the piece.
  if (!isShapeId(shape)) return <span className="dim">{shape}</span>;

  const cells = cellsOf(shape);
  const { rows, cols } = extentOf(shape);
  const gap = 1;
  const width = cols * size + (cols - 1) * gap;
  const height = rows * size + (rows - 1) * gap;

  return (
    <svg
      className="shape-icon"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? shape}
    >
      <title>{title ?? shape}</title>
      {cells.map(([row, col]) => (
        <rect
          key={`${row},${col}`}
          x={col * (size + gap)}
          y={row * (size + gap)}
          width={size}
          height={size}
          rx={1}
          fill={colour}
        />
      ))}
    </svg>
  );
}

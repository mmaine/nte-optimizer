/**
 * A character's console grid.
 *
 * Blocked cells are drawn as holes, free cells as the piece covering them, and
 * borders only where a piece meets something else - so a build reads as six to
 * eight objects rather than twenty squares.
 */
import { pieceColour, renderBoard } from "../domain/render.ts";

export interface BoardProps {
  cells: readonly number[];
  placement: readonly number[];
  pieces: number;
  /** Called with the piece index under the pointer, or null. */
  onHover?: (piece: number | null) => void;
  labelFor?: (piece: number) => string;
  size?: number;
  /** Piece to lift out of the board, matched to the legend row under the pointer. */
  highlight?: number | null;
  /**
   * Draw each piece's legend number on it. Off for the small boards in the team
   * view, where the digit would be larger than the cell.
   */
  numbered?: boolean;
}

export function Board({
  cells,
  placement,
  pieces,
  onHover,
  labelFor,
  size = 34,
  highlight = null,
  numbered = true,
}: BoardProps) {
  const render = renderBoard(cells, placement);
  const free = new Set(cells);

  return (
    <div
      className="board"
      style={{ gridTemplateColumns: `repeat(${render.cols}, ${size}px)` }}
      onPointerLeave={() => onHover?.(null)}
    >
      {Array.from({ length: render.rows * render.cols }, (_, index) => {
        if (!free.has(index)) {
          return <div key={index} className="board-cell board-cell--blocked" />;
        }
        const cell = render.cells.find((entry) => entry.cell === index)!;
        const hot = highlight !== null && highlight === cell.piece;
        // The number goes on the piece's first cell only, so a seven-cell piece
        // is labelled once rather than seven times.
        const first =
          numbered &&
          cell.piece >= 0 &&
          render.cells.find((entry) => entry.piece === cell.piece)?.cell === index;
        return (
          <div
            key={index}
            className={hot ? "board-cell board-cell--hot" : "board-cell"}
            title={labelFor?.(cell.piece)}
            onPointerEnter={() => onHover?.(cell.piece)}
            style={{
              background: pieceColour(cell.piece, pieces),
              borderTopWidth: cell.top ? 2 : 0,
              borderRightWidth: cell.right ? 2 : 0,
              borderBottomWidth: cell.bottom ? 2 : 0,
              borderLeftWidth: cell.left ? 2 : 0,
            }}
          >
            {first && <span className="board-index">{cell.piece + 1}</span>}
          </div>
        );
      })}
    </div>
  );
}

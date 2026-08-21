/**
 * The build, laid out so a player can act on it without hovering anything.
 *
 * Each piece on the board carries the colour and the number of its row in the
 * list beside it, and every row states the module's shape, type, level and
 * stats outright. Hover-only tooltips meant the information existed but could
 * not be read at a glance, scanned, or compared between two pieces - which is
 * the whole job here: read row 3, find that module in the game's inventory,
 * drop it in the highlighted cell.
 *
 * The cartridge sits under the board on its own, because it is not placed on
 * the grid at all - it is one choice for the whole build, and grouping it with
 * the modules implied it occupied cells.
 */
import { useState } from "react";

import { Board } from "./Board.tsx";
import { ShapeIcon } from "./ShapeIcon.tsx";
import { StatPair } from "./Stat.tsx";
import { typeName } from "./ItemCard.tsx";
import { pieceColour } from "../domain/render.ts";
import type { Database, ItemRow } from "../db/schema.ts";
import { resolveCharacter } from "../db/store.ts";
import type { GameData } from "../state/gamedata.ts";

export interface BuildLegendProps {
  cells: readonly number[];
  placement: readonly number[];
  pieces: number;
  gamedata: GameData;
  db: Database;
  /** The module in piece slot `piece`, if the build has one. */
  itemFor: (piece: number) => ItemRow | undefined;
  /** The cartridge chosen for this build, if any. */
  cartridge?: ItemRow | undefined;
}

export function BuildLegend({
  cells,
  placement,
  pieces,
  gamedata,
  db,
  itemFor,
  cartridge,
}: BuildLegendProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="build">
      <div className="build-main">
        <Board
          cells={cells}
          placement={placement}
          pieces={pieces}
          highlight={hovered}
          onHover={setHovered}
          labelFor={(piece) => {
            const item = itemFor(piece);
            return item ? `${piece + 1}. ${item.shape ?? item.set} +${item.level}` : "";
          }}
        />

        <ol className="legend">
          {Array.from({ length: pieces }, (_, piece) => {
            const item = itemFor(piece);
            const colour = pieceColour(piece, pieces);
            return (
              <li
                key={piece}
                className={hovered === piece ? "legend-row legend-row--hot" : "legend-row"}
                style={{ borderLeftColor: colour }}
                onPointerEnter={() => setHovered(piece)}
                onPointerLeave={() => setHovered(null)}
              >
                <span className="legend-index" style={{ background: colour }}>
                  {piece + 1}
                </span>
                {item ? (
                  <ItemLine item={item} gamedata={gamedata} db={db} colour={colour} />
                ) : (
                  <span className="dim">empty</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {cartridge && (
        <div className="cartridge-box">
          <h4>Cartridge</h4>
          <ItemLine item={cartridge} gamedata={gamedata} db={db} colour="var(--accent)" />
        </div>
      )}
    </div>
  );
}

/** One item's whole identity: how to recognise it in the game's own list. */
function ItemLine({
  item,
  gamedata,
  db,
  colour,
}: {
  item: ItemRow;
  gamedata: GameData;
  db: Database;
  colour: string;
}) {
  const type = typeName(item.cells);
  const row = db.equipment.find((entry) => entry.instance === item.instance);
  const owner = row ? resolveCharacter(row, db.ownerNames) : null;

  return (
    <div className="item-line">
      <div className="item-line-head">
        {item.shape && <ShapeIcon shape={item.shape} colour={colour} title={item.shape} />}
        <strong>
          {item.kind === "cartridge" ? item.set : `Module${type ? ` · Type ${type}` : ""}`}
        </strong>
        <span className="dim">+{item.level}</span>
        {item.kind === "module" && item.set && <span className="dim">{item.set}</span>}
        {/* R2's toggle makes this the difference between "free" and "you would
            be taking it off someone". */}
        {owner && <span className="worn">worn by {owner}</span>}
      </div>
      <div className="item-line-stats">
        {item.mainStats.map((stat) =>
          stat.value === null ? null : (
            <span key={`m-${stat.stat}`} className="main">
              <StatPair gamedata={gamedata} id={stat.stat} value={stat.value} />
            </span>
          ),
        )}
        {item.substats.map((stat) => (
          <span key={`s-${stat.stat}`} className="sub">
            <StatPair gamedata={gamedata} id={stat.stat} value={stat.value} />
          </span>
        ))}
      </div>
    </div>
  );
}

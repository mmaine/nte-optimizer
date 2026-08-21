import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { boardFromSlots, fillers, placements, tile } from "../src/domain/board.ts";
import { REQUIRED_PIECES, SET_IDS, SET_NAMES, activeTiers } from "../src/domain/cartridges.ts";
import { incompleteSets, setBonus, type SetBonusTable } from "../src/domain/setbonus.ts";
import { ICON_ORDER, SHAPES, renderShape, sizeOf } from "../src/domain/shapes.ts";
import { slotOf } from "../src/domain/statvec.ts";
import { pieceColour, renderBoard } from "../src/domain/render.ts";
import { cellsOfPiece, loadTilings, multisetOf, type RawTilings } from "../src/domain/tilings.ts";

const gamedata = JSON.parse(readFileSync("src/generated/gamedata.json", "utf8"));
const tilings = loadTilings(
  JSON.parse(readFileSync("src/generated/tilings.json", "utf8")) as RawTilings,
);

describe("shapes", () => {
  it("has exactly the twelve obtainable shapes", () => {
    expect(Object.keys(SHAPES).sort()).toEqual([...ICON_ORDER].sort());
    expect(ICON_ORDER).toHaveLength(12);
  });

  it("names each shape after its own cell count", () => {
    for (const shape of ICON_ORDER) {
      expect(sizeOf(shape)).toBe(Number(shape.slice(4, 5)));
    }
  });

  it("keeps the S and Z tetrominoes distinct", () => {
    // Rotating style5 gives 10/11/01, which is not style6: these are mirror
    // images, not one piece in two orientations.
    expect(renderShape("cell4_style5")).toEqual(["011", "110"]);
    expect(renderShape("cell4_style6")).toEqual(["01", "11", "10"]);
  });

  it("anchors every shape at the top-left corner", () => {
    for (const shape of ICON_ORDER) {
      const cells = SHAPES[shape];
      expect(Math.min(...cells.map(([r]) => r))).toBe(0);
      expect(Math.min(...cells.map(([, c]) => c))).toBe(0);
    }
  });
});

describe("cartridge sets", () => {
  it("requires four distinct shapes totalling twelve cells", () => {
    for (const set of SET_NAMES) {
      const required = REQUIRED_PIECES[set];
      expect(new Set(required).size).toBe(4);
      expect(required.reduce((sum, shape) => sum + sizeOf(shape), 0)).toBe(12);
    }
  });

  it("counts distinct shapes, not copies, toward a tier", () => {
    const [first, second] = REQUIRED_PIECES["Shadow Creed"];
    expect(activeTiers("Shadow Creed", [first!, first!, first!])).toEqual([]);
    expect(activeTiers("Shadow Creed", [first!, second!])).toEqual([2]);
    expect(activeTiers("Shadow Creed", REQUIRED_PIECES["Shadow Creed"])).toEqual([2, 4]);
  });
});

describe("boards", () => {
  const boards = gamedata.espers.map((esper: { slots: number[][] }) =>
    boardFromSlots(esper.slots),
  );

  it("gives every character twenty free cells", () => {
    for (const board of boards) expect(board.cells).toHaveLength(20);
  });

  it("collapses the roster onto four distinct grids", () => {
    expect(new Set(boards.map((b: { cells: number[] }) => b.cells.join(","))).size).toBe(4);
  });

  it("never places a shape off the right-hand edge", () => {
    // A naive translation wraps a wide piece onto the next row; every cell of
    // every placement must stay in its own row.
    for (const shape of ICON_ORDER) {
      for (const spot of placements(shape, boards[0]!)) {
        const cols = spot.map((cell) => cell % 7);
        expect(Math.max(...cols) - Math.min(...cols)).toBeLessThan(4);
      }
    }
  });

  it("finds sixty-nine filler multisets for the eight spare cells", () => {
    const found = fillers(8);
    expect(found).toHaveLength(69);
    for (const combo of found) {
      expect(combo.reduce((sum, shape) => sum + sizeOf(shape), 0)).toBe(8);
    }
  });

  it("refuses a multiset that cannot cover the board", () => {
    expect(tile(boards[0]!, ["cell2_style1", "cell2_style1"])).toBeNull();
  });
});

describe("precomputed tilings", () => {
  it("reproduces the Python search exactly", () => {
    const total = tilings.reduce(
      (sum, board) => sum + [...board.bySet.values()].reduce((n, list) => n + list.length, 0),
      0,
    );
    expect(tilings).toHaveLength(4);
    expect(total).toBe(1297);
  });

  it("builds are six, seven or eight pieces - never always seven", () => {
    const counts = new Map<number, number>();
    for (const board of tilings) {
      for (const list of board.bySet.values()) {
        for (const tiling of list) {
          counts.set(tiling.pieces.length, (counts.get(tiling.pieces.length) ?? 0) + 1);
        }
      }
    }
    expect([...counts.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [6, 30],
      [7, 1102],
      [8, 165],
    ]);
  });

  it("decodes back into a genuine exact cover", () => {
    for (const board of tilings) {
      for (const list of board.bySet.values()) {
        for (const tiling of list) {
          const covered = new Set<number>();
          tiling.pieces.forEach((shape, index) => {
            const cells = cellsOfPiece(tiling, index);
            expect(cells).toHaveLength(sizeOf(shape));
            for (const cell of cells) {
              expect(covered.has(cell)).toBe(false);
              covered.add(cell);
            }
          });
          expect([...covered].sort((a, b) => a - b)).toEqual(board.cells);
        }
      }
    }
  });

  it("every packing carries all four of its set's required shapes", () => {
    for (const board of tilings) {
      for (const [set, list] of board.bySet) {
        for (const tiling of list) {
          const present = multisetOf(tiling);
          for (const shape of REQUIRED_PIECES[set]) {
            expect(present.get(shape) ?? 0).toBeGreaterThan(0);
          }
          expect(activeTiers(set, tiling.pieces)).toEqual([2, 4]);
        }
      }
    }
  });

  it("leaves some (board, set) pairs unbuildable", () => {
    // Shadow Creed on one board admits only three fillers; the UI needs a
    // defined "no valid full-set build" state because of exactly this.
    const smallest = Math.min(
      ...tilings.flatMap((board) => [...board.bySet.values()].map((list) => list.length)),
    );
    expect(smallest).toBeLessThan(10);
  });
});

describe("set bonuses", () => {
  const table = JSON.parse(
    readFileSync("data-src/set-bonuses.json", "utf8"),
  ) as SetBonusTable;

  it("covers all twelve sets", () => {
    expect(Object.keys(table.sets).sort()).toEqual([...SET_NAMES].sort());
  });

  it("names the three unowned sets by their real ids", () => {
    // Confirmed from everness's cartridge boxes. Blood/Night/Kingdom was a
    // guess and was wrong on all three.
    expect(SET_IDS["Psyche_orange"]).toBe("Devil's Blood: Curse");
    expect(SET_IDS["Shield_orange"]).toBe("Kingdom's Guard");
    expect(SET_IDS["Heal_orange"]).toBe("Thea's Night Tavern");
    expect(Object.keys(SET_IDS)).toHaveLength(12);
  });

  it("classifies every tier and preserves the three honest model gaps", () => {
    expect(table.format_version).toBe(2);
    expect(Object.values(table.sets).flatMap((tiers) => Object.values(tiers))).toHaveLength(24);
    expect(
      Object.entries(table.sets)
        .filter(([, tiers]) => tiers["4"].mode === "unmodellable")
        .map(([set]) => set)
        .sort(),
    ).toEqual(["Diabolos", "Kingdom's Guard", "Speedy Hedgehog"]);
    expect(incompleteSets(table)).toEqual([]);
  });

  it("uses the user-decided Mental DMG mapping", () => {
    expect(table.sets["Quiet Manor"]!["2"].stats).toEqual([
      { stat: "DamageUpPsychicallyBase", value: 0.1 },
    ]);
    expect(table.sets["Quiet Manor"]!["2"].why).toContain("circumstantial");
  });

  it("scores only selected tiers and reports timed tiers it omits", () => {
    const required = REQUIRED_PIECES["Shadow Creed"];
    const twoPiece = setBonus(table, "Shadow Creed", required, 2);
    expect(twoPiece.vector[slotOf("AtkUp")]).toBeCloseTo(0.1);
    expect(twoPiece.omittedTiers).toEqual([]);

    const full = setBonus(table, "Shadow Creed", required, 4);
    expect(full.vector[slotOf("AtkUp")]).toBeCloseTo(0.1);
    expect(full.omittedTiers).toEqual([
      { tier: 4, mode: "duration", why: table.sets["Shadow Creed"]!["4"].why },
    ]);
  });

  it("uses stated maximum stacks when aiming for 2+4", () => {
    const result = setBonus(
      table,
      "Crimson: Twin Butterflies",
      REQUIRED_PIECES["Crimson: Twin Butterflies"],
      4,
    );
    expect(result.vector[slotOf("DamageUpIncantationBase")]).toBeCloseTo(0.1);
    expect(result.vector[slotOf("AtkUp")]).toBeCloseTo(0.36);
  });
});

describe("board rendering", () => {
  it("borders only the sides facing a different piece", () => {
    // A horizontal domino: the join between the two cells carries no border.
    const render = renderBoard([0, 1], [0, 0]);
    const [left, right] = render.cells;
    expect(left!.right).toBe(false);
    expect(right!.left).toBe(false);
    expect(left!.left).toBe(true);
    expect(left!.top).toBe(true);
    expect(right!.right).toBe(true);
  });

  it("borders the join between two different pieces", () => {
    const render = renderBoard([0, 1], [0, 1]);
    expect(render.cells[0]!.right).toBe(true);
    expect(render.cells[1]!.left).toBe(true);
  });

  it("treats a blocked neighbour as an edge", () => {
    // Cell 2 is not on the board, so cell 1's right side is an outer edge.
    const render = renderBoard([0, 1], [0, 0]);
    expect(render.cells[1]!.right).toBe(true);
  });

  it("does not wrap a border round the end of a row", () => {
    // Cells 6 and 7 are adjacent in index but sit in different rows.
    const render = renderBoard([6, 7], [0, 0]);
    expect(render.cells[0]!.right).toBe(true);
    expect(render.cells[1]!.left).toBe(true);
  });

  it("renders a real packing as one block per piece", () => {
    const board = tilings[0]!;
    const [tiling] = [...board.bySet.values()][0]!;
    const render = renderBoard(tiling!.cells, tiling!.placement);
    expect(render.cells).toHaveLength(20);
    // Every cell belongs to a piece, and every piece is contiguous enough that
    // its internal joins are unbordered.
    const internal = render.cells.filter((c) => !c.top || !c.right || !c.bottom || !c.left);
    expect(internal.length).toBe(20);
    expect(new Set(render.cells.map((c) => c.piece)).size).toBe(tiling!.pieces.length);
  });

  it("gives every piece of a build a distinct colour", () => {
    const colours = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((i) => pieceColour(i, 8)));
    expect(colours.size).toBe(8);
    expect(pieceColour(-1, 8)).toBe("transparent");
  });
});

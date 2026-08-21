/**
 * The owned pool, as the solver wants it.
 *
 * An export gives items as records with named stats. The solver wants one flat
 * `Float32Array` and integer indices into it, so this is the one place the two
 * representations meet. Nothing downstream of here handles a stat by name.
 */
import { SET_IDS, type SetName } from "./cartridges.ts";
import type { ShapeId } from "./shapes.ts";
import { SHAPES } from "./shapes.ts";
import { emptyPool, poolSlice, vectorFrom, type StatPair } from "./statvec.ts";

/** One item as an export spells it. */
export interface ExportedItem {
  instance: string;
  kind: "module" | "cartridge";
  item_id: string;
  // Explicitly `| undefined`: `exactOptionalPropertyTypes` otherwise refuses a
  // value built by spreading a row whose field may be absent.
  shape?: string | undefined;
  module_type?: string | undefined;
  set?: string | undefined;
  level: number;
  rarity: string;
  main_stats: StatPair[];
  substats: StatPair[];
  owner_group: string | null;
}

export interface OwnedItem {
  instance: string;
  kind: "module" | "cartridge";
  itemId: string;
  /** Modules only. */
  shape: ShapeId | null;
  /** 2, 3 or 4. Modules only. */
  cells: number | null;
  /** Cartridges only. */
  set: SetName | null;
  level: number;
  rarity: string;
  ownerGroup: string | null;
  /** Index into the pool's flat vector array. */
  index: number;
  /**
   * The cartridge's main stat, which enters scoring only as a tiebreak. Null
   * for modules, whose mains are fixed by cell count and carry no choice.
   */
  mainStat: string | null;
}

export interface ItemPool {
  items: OwnedItem[];
  /** `items.length * SLOT_COUNT` values, laid end to end. */
  vectors: Float32Array;
  modulesByShape: Map<ShapeId, number[]>;
  cartridgesBySet: Map<SetName, number[]>;
  /** Items an import says are already worn, by owner group. */
  equippedByOwner: Map<string, number[]>;
  /** Item ids the decoder emitted that this build has no shape for. */
  unknownShapes: string[];
}

const isShapeId = (value: string): value is ShapeId => value in SHAPES;

/**
 * Build the pool.
 *
 * Level is deliberately not a filter: substat values are identical at +0 and
 * +20, so an unlevelled item is a valid recommendation and the UI shows its
 * level rather than the solver hiding it.
 */
export function buildPool(exported: readonly ExportedItem[]): ItemPool {
  const items: OwnedItem[] = [];
  const vectors = emptyPool(exported.length);
  const modulesByShape = new Map<ShapeId, number[]>();
  const cartridgesBySet = new Map<SetName, number[]>();
  const equippedByOwner = new Map<string, number[]>();
  const unknownShapes: string[] = [];

  exported.forEach((raw, index) => {
    const shape = raw.shape && isShapeId(raw.shape) ? raw.shape : null;
    if (raw.kind === "module" && shape === null) unknownShapes.push(raw.item_id);

    const set =
      raw.kind === "cartridge"
        ? (SET_IDS[raw.item_id] ?? (raw.set as SetName | undefined) ?? null)
        : null;

    vectorFrom(raw.main_stats, poolSlice(vectors, index));
    vectorFrom(raw.substats, poolSlice(vectors, index));

    const item: OwnedItem = {
      instance: raw.instance,
      kind: raw.kind,
      itemId: raw.item_id,
      shape,
      cells: shape ? SHAPES[shape].length : null,
      set,
      level: raw.level,
      rarity: raw.rarity,
      ownerGroup: raw.owner_group,
      index,
      mainStat: raw.kind === "cartridge" ? (raw.main_stats[0]?.stat ?? null) : null,
    };
    items.push(item);

    if (item.kind === "module" && shape) {
      const bucket = modulesByShape.get(shape);
      if (bucket) bucket.push(index);
      else modulesByShape.set(shape, [index]);
    }
    if (item.kind === "cartridge" && set) {
      const bucket = cartridgesBySet.get(set);
      if (bucket) bucket.push(index);
      else cartridgesBySet.set(set, [index]);
    }
    if (item.ownerGroup) {
      const bucket = equippedByOwner.get(item.ownerGroup);
      if (bucket) bucket.push(index);
      else equippedByOwner.set(item.ownerGroup, [index]);
    }
  });

  return { items, vectors, modulesByShape, cartridgesBySet, equippedByOwner, unknownShapes };
}

/** Indices of every module of a shape, minus anything excluded. */
export function availableModules(
  pool: ItemPool,
  shape: ShapeId,
  excluded: ReadonlySet<number>,
): number[] {
  const all = pool.modulesByShape.get(shape) ?? [];
  return excluded.size === 0 ? all : all.filter((index) => !excluded.has(index));
}

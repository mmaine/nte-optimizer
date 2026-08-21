/**
 * Everything needed to find one module in the game's own inventory.
 *
 * Instance ids mean nothing to a person, so identification is by the properties
 * visible on the item in game: shape, type, level, rarity, main stat and all
 * four substats. That is the whole point of the visual result - read the block,
 * find the matching module in your list, drop it in the cell shown.
 */
import type { ItemRow } from "../db/schema.ts";
import type { Database } from "../db/schema.ts";
import { resolveCharacter } from "../db/store.ts";

export function typeName(cells: number | null): string | null {
  if (cells === 2) return "II";
  if (cells === 3) return "III";
  if (cells === 4) return "IV";
  return null;
}

export function ItemCard({ item, db }: { item: ItemRow | undefined; db: Database }) {
  if (!item) return null;
  const row = db.equipment.find((entry) => entry.instance === item.instance);
  const owner = row ? resolveCharacter(row, db.ownerNames) : null;
  const type = typeName(item.cells);
  return (
    <div className="tooltip">
      <strong>
        {item.shape ?? item.set}
        {type ? ` · Type ${type}` : ""} · +{item.level} · {item.rarity}
      </strong>
      <div>{item.mainStats.map((stat) => stat.stat).join(", ") || "—"}</div>
      <ul>
        {item.substats.map((stat) => (
          <li key={stat.stat}>
            {stat.stat} {stat.value}
          </li>
        ))}
      </ul>
      {/* R2's toggle makes this the difference between "free" and "you would be
          taking it off someone". */}
      {owner && <div className="dim">Equipped by: {owner}</div>}
    </div>
  );
}

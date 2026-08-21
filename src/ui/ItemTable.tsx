/**
 * The Cartridges and Modules tabs.
 *
 * One component, because the two differ only in which columns distinguish an
 * item. 817 rows is `.filter().sort()` on an array - a table library would earn
 * nothing here and would be one more thing to still work in three years.
 *
 * Filters combine on purpose: "Crimson with a CRIT DMG main and a Cycle sub" is
 * the question a player actually asks.
 */
import { useMemo, useState } from "react";

import { useStore } from "./useStore.ts";

import { STAT_SLOTS } from "../domain/statvec.ts";
import type { ItemRow } from "../db/schema.ts";

export interface ItemTableProps {
  kind: "cartridge" | "module";
  items: readonly ItemRow[];
  /** Owner group per instance, when the item is worn. */
  ownerOf: (instance: string) => string | null;
}

type SortKey = "itemId" | "level" | "set" | "shape";

export function ItemTable({ kind, items, ownerOf }: ItemTableProps) {
  const [group, setGroup] = useState("");
  const [main, setMain] = useState("");
  const [sub, setSub] = useState("");
  const [minLevel, setMinLevel] = useState(0);
  const [sort, setSort] = useState<SortKey>(kind === "cartridge" ? "set" : "shape");
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(() => {
    const filtered = items.filter((item) => {
      if (item.kind !== kind) return false;
      if (group && (kind === "cartridge" ? item.set : item.shape) !== group) return false;
      if (main && !item.mainStats.some((stat) => stat.stat === main)) return false;
      if (sub && !item.substats.some((stat) => stat.stat === sub)) return false;
      if (item.level < minLevel) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "level") return b.level - a.level;
      const left = String(a[sort] ?? "");
      const right = String(b[sort] ?? "");
      return left.localeCompare(right) || a.itemId.localeCompare(b.itemId);
    });
  }, [items, kind, group, main, sub, minLevel, sort]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    for (const item of items) {
      if (item.kind !== kind) continue;
      const value = kind === "cartridge" ? item.set : item.shape;
      if (value) seen.add(value);
    }
    return [...seen].sort();
  }, [items, kind]);

  return (
    <section>
      <div className="filters">
        <label>
          {kind === "cartridge" ? "Set" : "Shape"}
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">any</option>
            {groups.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Main
          <select value={main} onChange={(event) => setMain(event.target.value)}>
            <option value="">any</option>
            {STAT_SLOTS.map((stat) => (
              <option key={stat} value={stat}>
                {stat}
              </option>
            ))}
          </select>
        </label>
        <label>
          Substat
          <select value={sub} onChange={(event) => setSub(event.target.value)}>
            <option value="">any</option>
            {STAT_SLOTS.map((stat) => (
              <option key={stat} value={stat}>
                {stat}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min level
          <input
            type="number"
            min={0}
            max={20}
            value={minLevel}
            onChange={(event) => setMinLevel(Number(event.target.value))}
          />
        </label>
        <label>
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            {kind === "cartridge" ? <option value="set">set</option> : <option value="shape">shape</option>}
            <option value="level">level</option>
            <option value="itemId">id</option>
          </select>
        </label>
        <span className="count">
          {rows.length} of {items.filter((item) => item.kind === kind).length}
        </span>
      </div>

      <table className="items">
        <thead>
          <tr>
            <th>{kind === "cartridge" ? "Set" : "Shape"}</th>
            {kind === "module" && <th>Type</th>}
            <th>Level</th>
            <th>Main</th>
            <th>Substats</th>
            <th>Worn by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.instance}
              className={editing === item.instance ? "row--editing" : "row--clickable"}
              onClick={() => setEditing(editing === item.instance ? null : item.instance)}
            >
              <td>{kind === "cartridge" ? item.set : item.shape}</td>
              {kind === "module" && <td>{item.cells === 2 ? "II" : item.cells === 3 ? "III" : "IV"}</td>}
              {/* Level is not a filter on purpose: substats are identical at +0
                  and +20, so an unlevelled item is a valid recommendation. */}
              <td>+{item.level}</td>
              <td>
                {item.mainStats.map((stat) => stat.stat).join(", ") || <span className="dim">—</span>}
              </td>
              <td className="subs">
                {item.substats.map((stat) => `${stat.stat} ${stat.value}`).join("  ·  ")}
              </td>
              <td>{ownerOf(item.instance) ?? <span className="dim">—</span>}</td>
            </tr>
          ))}
          {editing && rows.some((item) => item.instance === editing) && (
            <tr className="editor-row">
              <td colSpan={kind === "module" ? 6 : 5}>
                <ItemEditor
                  item={rows.find((item) => item.instance === editing)!}
                  onDone={() => setEditing(null)}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Correcting a decoded item by hand.
 *
 * Only the values a decode can plausibly get wrong are editable - level and the
 * substat numbers. Shape, kind and instance are structural: if those are wrong
 * the record was misparsed entirely and editing it would paper over a bug worth
 * reporting instead.
 */
function ItemEditor({
  item,
  onDone,
}: {
  item: ItemRow;
  onDone: () => void;
}) {
  const store = useStore();
  const [level, setLevel] = useState(item.level);
  const [substats, setSubstats] = useState(item.substats);

  return (
    <div className="editor" onClick={(event) => event.stopPropagation()}>
      <p className="dim">
        Corrections are overwritten by the next gear import — the import is the game speaking.
      </p>
      <label>
        Level
        <input
          type="number"
          min={0}
          max={20}
          value={level}
          onChange={(event) => setLevel(Number(event.target.value))}
        />
      </label>
      {substats.map((stat, index) => (
        <label key={stat.stat}>
          {stat.stat}
          <input
            type="number"
            step="any"
            value={stat.value}
            onChange={(event) => {
              const next = [...substats];
              next[index] = { ...stat, value: Number(event.target.value) };
              setSubstats(next);
            }}
          />
        </label>
      ))}
      <div className="actions">
        <button
          onClick={() => {
            void store.editItem(item.instance, { level, substats });
            onDone();
          }}
        >
          Save
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

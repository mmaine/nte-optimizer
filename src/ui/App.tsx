import { useEffect, useState } from "react";

import { Store } from "../state/store.ts";
import { loadGameData, type LoadedData } from "../state/gamedata.ts";
import { resolveCharacter, todoInGame, unnamedGroups } from "../db/store.ts";
import { DataPanel } from "./DataPanel.tsx";
import { ItemTable } from "./ItemTable.tsx";
import { CharactersTab } from "./CharactersTab.tsx";
import { TeamTab } from "./TeamTab.tsx";
import { StoreContext, useAppState } from "./useStore.ts";
import { hashFor, useRoute, TABS } from "./router.ts";

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [opened, loaded] = await Promise.all([Store.open(), loadGameData()]);
        if (cancelled) return;
        setStore(opened);
        setData(loaded);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="problem">Could not start: {error}</p>;
  if (!store || !data) return <p className="dim">Loading…</p>;

  return (
    <StoreContext.Provider value={store}>
      <Shell data={data} />
    </StoreContext.Provider>
  );
}

function Shell({ data }: { data: LoadedData }) {
  const state = useAppState();
  const route = useRoute();
  const db = state.data.db;

  /**
   * Owner groups get a stable number, not their raw id.
   *
   * "group 0000000088" told the player nothing they could act on. The number is
   * the group's position in the sorted list of groups, so it is stable within an
   * import and the same group reads the same everywhere; the raw id stays in the
   * title attribute for anyone debugging a capture.
   */
  const groupNumbers = new Map(
    [...new Set(db.equipment.map((row) => row.ownerGroup).filter((id) => id !== null))]
      .sort()
      .map((id, index) => [id, index + 1] as const),
  );

  const ownerOf = (instance: string): { label: string; named: boolean; title?: string } | null => {
    const row = db.equipment.find((entry) => entry.instance === instance);
    if (!row) return null;
    const named = resolveCharacter(row, db.ownerNames);
    if (named) return { label: named, named: true };
    if (!row.ownerGroup) return null;
    return {
      label: `Unnamed group ${groupNumbers.get(row.ownerGroup) ?? "?"}`,
      named: false,
      title: row.ownerGroup,
    };
  };

  const todo = todoInGame(db);
  const unnamed = unnamedGroups(db);

  return (
    <div className="app">
      <header>
        <h1>NTE gear optimizer</h1>
        <nav>
          {TABS.map((tab) => (
            <a key={tab} href={hashFor(tab)} className={route.tab === tab ? "active" : ""}>
              {tab}
            </a>
          ))}
        </nav>
      </header>

      {/* The degraded persistence tiers have to say so, permanently. */}
      {!state.durable && (
        <p className="warning">
          Storage is not durable here ({state.adapterKind}). Use <strong>Export database</strong>
          {" "}to keep your work.
        </p>
      )}

      {db.items.length === 0 && (
        <p className="empty">
          No gear imported yet. Run the exporter, then import the{" "}
          <code>*_Gear_*.json</code> file it writes.
        </p>
      )}

      <main>
        {route.tab === "cartridges" && (
          <ItemTable kind="cartridge" items={db.items} gamedata={data.gamedata} ownerOf={ownerOf} />
        )}
        {route.tab === "modules" && (
          <ItemTable kind="module" items={db.items} gamedata={data.gamedata} ownerOf={ownerOf} />
        )}
        {route.tab === "characters" && (
          <CharactersTab
            data={data}
            route={route}
            unnamedGroups={unnamed}
            groupNumbers={groupNumbers}
          />
        )}
        {route.tab === "team" && <TeamTab data={data} />}
        {route.tab === "data" && (
          <DataPanel gamedataVersion={data.gamedata.generated} todo={todo} />
        )}
      </main>
    </div>
  );
}

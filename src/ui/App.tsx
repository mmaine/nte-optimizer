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

  const ownerOf = (instance: string): string | null => {
    const row = db.equipment.find((entry) => entry.instance === instance);
    if (!row) return null;
    return resolveCharacter(row, db.ownerNames) ?? `group ${row.ownerGroup?.slice(0, 8)}`;
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

      <DataPanel gamedataVersion={data.gamedata.generated} />

      {todo.size > 0 && (
        <details className="todo">
          <summary>To do in game ({[...todo.values()].flat().length} pieces)</summary>
          {[...todo].map(([character, rows]) => (
            <p key={character || "unassigned"}>
              <strong>{character || "unassigned"}</strong>: {rows.length} pieces
            </p>
          ))}
        </details>
      )}

      <main>
        {route.tab === "cartridges" && (
          <ItemTable kind="cartridge" items={db.items} ownerOf={ownerOf} />
        )}
        {route.tab === "modules" && (
          <ItemTable kind="module" items={db.items} ownerOf={ownerOf} />
        )}
        {route.tab === "characters" && (
          <CharactersTab data={data} route={route} unnamedGroups={unnamed} />
        )}
        {route.tab === "team" && <TeamTab data={data} />}
      </main>
    </div>
  );
}

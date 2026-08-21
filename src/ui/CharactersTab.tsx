/**
 * Characters, and one character's optimizer view.
 *
 * The list is every character the capture saw. Seven codenames have no everness
 * record at all (`Chiichan073`, `Female051`, `Jin`, `Kuhara`, `Mint019`,
 * `Mitsuki`, `Oneiroi`), so the card has to work without artwork, a grid or stat
 * curves rather than assuming they exist.
 */
import { esperFor, type LoadedData } from "../state/gamedata.ts";
import { CharacterView } from "./CharacterView.tsx";
import { Icon } from "./Icon.tsx";
import { equipmentOf } from "../db/store.ts";
import { hashFor, type Route } from "./router.ts";
import { useAppState, useStore } from "./useStore.ts";

export function CharactersTab({
  data,
  route,
  unnamedGroups,
}: {
  data: LoadedData;
  route: Route;
  unnamedGroups: string[];
}) {
  const state = useAppState();
  const db = state.data.db;

  if (route.id) return <CharacterView data={data} characterId={route.id} />;

  return (
    <section>
      {unnamedGroups.length > 0 && (
        <UnidentifiedGroups groups={unnamedGroups} data={data} />
      )}
      <div className="cards">
        {db.characters.map((character) => {
          const esper = esperFor(data.gamedata, character.characterId);
          return (
            <a
              key={character.characterId}
              className="card"
              href={hashFor("characters", character.characterId)}
            >
              <span className="card-head">
                <Icon entry={`esper:${character.characterId}`} alt={esper?.name ?? character.characterId} />
                <strong>{esper?.name ?? character.characterId}</strong>
              </span>
              <span className="dim">
                {esper ? esper.element : "no game data"} · level {character.level ?? "?"} ·{" "}
                {character.breakthroughs ?? "?"} breakthroughs
              </span>
              <span className="dim">
                {equipmentOf(db, character.characterId).length} pieces equipped
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The owner groups nobody has named.
 *
 * Seven of thirteen cannot be matched from the capture at all - three sets of
 * characters share both their module shapes and their cartridge set - so the
 * player names them once, keyed on values that are stable across exports.
 */
function UnidentifiedGroups({ groups, data }: { groups: string[]; data: LoadedData }) {
  const store = useStore();
  const state = useAppState();
  const db = state.data.db;

  return (
    <div className="unidentified">
      <h2>Unidentified groups</h2>
      <p className="dim">
        The capture says these items are worn together, but not by whom. Name each group once
        and it sticks.
      </p>
      {groups.map((group) => {
        const worn = db.equipment.filter((row) => row.ownerGroup === group);
        const items = worn
          .map((row) => db.items.find((item) => item.instance === row.instance))
          .filter((item) => item !== undefined);
        return (
          <div key={group} className="group">
            <code>{group.slice(0, 12)}</code>
            <span className="dim">
              {items.map((item) => item.shape ?? item.set).join(", ")}
            </span>
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) void store.nameGroup(group, event.target.value);
              }}
            >
              <option value="">name this group…</option>
              {data.gamedata.espers.map((esper) => (
                <option key={esper.abilityKey} value={esper.abilityKey}>
                  {esper.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

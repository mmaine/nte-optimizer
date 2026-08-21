/**
 * Stat ids rendered the way the game writes them.
 *
 * Every stat the player sees goes through here. The label comes from
 * `domain/statlabels.ts`, which reads the game's own wording out of the game
 * data and marks the few it had to derive - those get a `title` saying so, so a
 * derived label is never mistaken for the game's.
 */
import { formatStatValue, statLabel } from "../domain/statlabels.ts";
import type { GameData } from "../state/gamedata.ts";

export function useStatText(gamedata: GameData) {
  const names = gamedata.statNames ?? {};
  return {
    label: (id: string) => statLabel(names, id),
    name: (id: string) => statLabel(names, id).name,
    value: (id: string, value: number) => formatStatValue(statLabel(names, id), value),
    full: (id: string, value: number) => {
      const label = statLabel(names, id);
      return `${label.name} ${formatStatValue(label, value)}`;
    },
  };
}

export function StatName({ gamedata, id }: { gamedata: GameData; id: string }) {
  const label = statLabel(gamedata.statNames ?? {}, id);
  return (
    <span
      className={label.source === "derived" ? "stat stat--derived" : "stat"}
      title={label.source === "derived" ? `${id} — name derived: ${label.note}` : id}
    >
      {label.name}
    </span>
  );
}

export function StatPair({
  gamedata,
  id,
  value,
}: {
  gamedata: GameData;
  id: string;
  value: number;
}) {
  const label = statLabel(gamedata.statNames ?? {}, id);
  return (
    <span className="stat-pair">
      <StatName gamedata={gamedata} id={id} />
      <b>{formatStatValue(label, value)}</b>
    </span>
  );
}

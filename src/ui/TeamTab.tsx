/**
 * The team tab.
 *
 * Four characters, dragged into a priority order, solved together against the
 * shared pool by one button. The drag order is the **tie-break** the solver
 * applies once the sorted score vector is already fixed - it is not a sequential
 * pass, and the whole point of the team solve is that the first character does
 * not simply take everything.
 *
 * Drag and drop is four native HTML5 events; a drag library would be a fifth
 * dependency for that.
 */
import { useRef, useState } from "react";

import { isKnownStat, SLOT_COUNT, type StatId } from "../domain/statvec.ts";
import type { StatTarget } from "../domain/scoring.ts";
import { consoleTrait } from "../domain/stats.ts";
import { createSolverHost, CancelledError, type SolveHandle } from "../solver/host.ts";
import type { JobProgress, JobResult, SolveJob } from "../solver/job.ts";
import type { TeamAssignment } from "../solver/team.ts";
import { heldByOthers } from "../db/store.ts";
import { esperFor, type LoadedData } from "../state/gamedata.ts";
import { BuildLegend } from "./BuildLegend.tsx";
import { Icon } from "./Icon.tsx";
import { useAppState, useStore } from "./useStore.ts";

const TEAM_SIZE = 4;

/**
 * Custom targets are stored with a plain string stat, because the store must
 * survive a slot being added later. Anything the model has no slot for is
 * dropped here rather than being allowed to reach the solver.
 */
function targetsFor(
  custom: Array<{ stat: string; target: number; weight: number }> | null | undefined,
): StatTarget[] {
  if (custom && custom.length > 0) {
    return custom
      .filter((entry) => isKnownStat(entry.stat))
      .map((entry) => ({
        stat: entry.stat as StatId,
        target: entry.target,
        weight: entry.weight,
      }));
  }
  return [
    { stat: "CritBase", target: 0.7, weight: 3 },
    { stat: "CritDamageBase", target: 2.0, weight: 3 },
  ];
}

export function TeamTab({ data }: { data: LoadedData }) {
  const state = useAppState();
  const store = useStore();
  const db = state.data.db;

  const [team, setTeam] = useState<string[]>([]);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const handle = useRef<SolveHandle | null>(null);
  const [running, setRunning] = useState(false);
  const dragged = useRef<number | null>(null);
  // R2, for the team: items worn by anyone outside the team.
  const [useEquipped, setUseEquipped] = useState(false);

  const solve = async () => {
    setProblem(null);
    setResult(null);
    setRunning(true);

    const job: SolveJob = {
      items: db.items.map((item) => ({
        instance: item.instance,
        kind: item.kind,
        item_id: item.itemId,
        shape: item.shape ?? undefined,
        set: item.set ?? undefined,
        level: item.level,
        rarity: item.rarity,
        main_stats: item.mainStats,
        substats: item.substats,
        owner_group: null,
      })),
      setBonuses: data.setBonuses,
      tilings: data.tilings,
      dragOrder: team,
      characters: team.flatMap((characterId) => {
        const esper = esperFor(data.gamedata, characterId);
        if (!esper) return [];
        const stored = db.characters.find((row) => row.characterId === characterId);
        return [
          {
            key: characterId,
            slots: esper.slots,
            trait: consoleTrait(esper),
            base: new Array(SLOT_COUNT).fill(0),
            scoring: { targets: targetsFor(stored?.customTargets) },
            excludedInstances: useEquipped ? [] : heldByOthers(db, team),
          },
        ];
      }),
    };

    const host = createSolverHost();
    const started = host.solve(job, setProgress);
    handle.current = started;
    try {
      setResult(await started.promise);
    } catch (error) {
      if (!(error instanceof CancelledError)) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setRunning(false);
      host.dispose();
    }
  };

  const reorder = (from: number, to: number) => {
    setTeam((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };

  return (
    <section>
      <h2>Team</h2>
      <p className="dim">
        Drag to set priority. Order breaks ties only — it never decides who gets an item.
      </p>

      <ol className="team">
        {team.map((characterId, index) => (
          <li
            key={characterId}
            draggable
            onDragStart={() => (dragged.current = index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragged.current !== null) reorder(dragged.current, index);
              dragged.current = null;
            }}
          >
            {esperFor(data.gamedata, characterId)?.name ?? characterId}
            <button onClick={() => setTeam(team.filter((key) => key !== characterId))}>
              remove
            </button>
          </li>
        ))}
      </ol>

      {team.length < TEAM_SIZE && (
        <select
          value=""
          onChange={(event) => {
            if (event.target.value) setTeam([...team, event.target.value]);
          }}
        >
          <option value="">add a character…</option>
          {db.characters
            .filter((row) => !team.includes(row.characterId))
            .map((row) => (
              <option key={row.characterId} value={row.characterId}>
                {esperFor(data.gamedata, row.characterId)?.name ?? row.characterId}
              </option>
            ))}
        </select>
      )}

      <label className="toggle">
        <input
          type="checkbox"
          checked={useEquipped}
          onChange={(event) => setUseEquipped(event.target.checked)}
        />
        Use items characters outside the team are wearing
      </label>

      <div className="actions">
        <button disabled={team.length === 0 || running} onClick={() => void solve()}>
          Optimize team
        </button>
        {/* Stop always yields something usable: the solve is anytime. */}
        <button disabled={!running} onClick={() => handle.current?.cancel()}>
          Stop
        </button>
      </div>

      {running && progress && <Progress progress={progress} />}
      {problem && <p className="problem">{problem}</p>}
      {result && <Result result={result} data={data} store={store} />}
    </section>
  );
}

function Progress({ progress }: { progress: JobProgress }) {
  if (progress.phase === "portfolio") {
    return (
      <p className="dim">
        {progress.character}: {progress.done} / {progress.total} packings
      </p>
    );
  }
  return (
    <p className="dim">
      round {progress.round} / {progress.rounds} — [
      {progress.sorted.map((value) => value.toFixed(3)).join(", ")}]
    </p>
  );
}

function Result({
  result,
  data,
  store,
}: {
  result: JobResult;
  data: LoadedData;
  store: ReturnType<typeof useStore>;
}) {
  const state = useAppState();
  if (result.infeasible) {
    return <p className="warning">No conflict-free team could be built from this pool.</p>;
  }
  return (
    <div className="result">
      <p>
        Scores, worst first: [{result.sorted.map((value) => value.toFixed(4)).join(", ")}]
      </p>
      {result.unbuildable.length > 0 && (
        <p className="warning">
          No valid full-set build for: {result.unbuildable.join(", ")}
        </p>
      )}
      <div className="boards">
        {result.assignment.map((entry) => (
          <AssignedBuild key={entry.key} entry={entry} data={data} />
        ))}
      </div>
      <p className="dim">
        Equipping writes an “app” row you still have to apply in game.{" "}
        {state.data.undo.length > 0 && (
          <button onClick={() => void store.undo()}>Undo last equip</button>
        )}
      </p>
    </div>
  );
}

/**
 * One character's share of a team solve, drawn.
 *
 * The board is the deliverable, not the score: the player reads a block, finds
 * that module in their inventory by its stats, and puts it in the cell shown.
 */
function AssignedBuild({
  entry,
  data,
}: {
  entry: TeamAssignment;
  data: LoadedData;
}) {
  const state = useAppState();
  const db = state.data.db;
  const store = useStore();
  const build = entry.build;

  const itemFor = (piece: number) => {
    const index = build.modules[piece];
    return index === undefined ? undefined : db.items[index];
  };

  const equip = () => {
    const instances = [build.cartridge, ...build.modules]
      .map((index) => db.items[index]?.instance)
      .filter((instance) => instance !== undefined);
    const cells: Record<string, number[]> = {};
    build.modules.forEach((index, piece) => {
      const instance = db.items[index]?.instance;
      if (!instance) return;
      cells[instance] = build.tiling.cells.filter(
        (_cell, position) => build.tiling.placement[position] === piece,
      );
    });
    void store.equip(entry.key, instances, { cells });
  };

  return (
    <div className="assignment">
      <div className="card-head">
        <Icon entry={`esper:${entry.key}`} alt={entry.key} size={36} />
        <strong>{esperFor(data.gamedata, entry.key)?.name ?? entry.key}</strong>
        <span className="dim">
          {build.score.toFixed(4)} · {build.modules.length} modules ·{" "}
          {build.proven ? "optimal for this packing and cartridge" : "best found"}
        </span>
      </div>

      {build.unknownTiers.length > 0 && (
        <p className="warning">
          Set bonus tier {build.unknownTiers.join(" and ")} is active but unmeasured, so it
          contributes nothing to this score.
        </p>
      )}

      <BuildLegend
        cells={build.tiling.cells}
        placement={build.tiling.placement}
        pieces={build.tiling.pieces.length}
        gamedata={data.gamedata}
        db={db}
        itemFor={itemFor}
        cartridge={db.items[build.cartridge]}
      />

      <div className="actions">
        <button onClick={equip}>Equip on {entry.key}</button>
      </div>
    </div>
  );
}

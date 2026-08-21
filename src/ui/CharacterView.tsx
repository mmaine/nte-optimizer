/**
 * One character's optimizer view.
 *
 * Holds the Arc selector, the console grid the result is drawn into, the
 * targets the solve runs against, and Equip.
 *
 * Two things this view has to be honest about rather than paper over:
 *
 * - A set bonus whose value nobody has measured contributes **nothing**, and the
 *   panel says so. Scoring it as zero silently would look like a real number.
 * - `proven` means "no better module assignment for this packing and cartridge",
 *   not global optimality, and the label says exactly that.
 */
import { useMemo, useRef, useState } from "react";

import { arcContribution, arcControls, MAX_ARC_LEVEL, MAX_REFINEMENT } from "../domain/arcs.ts";
import { boardFromSlots } from "../domain/board.ts";
import { compile, explain, type StatTarget } from "../domain/scoring.ts";
import { guideFor, targetsFromGuide, variantFor } from "../domain/guides.ts";
import { compareSheet, predictSheet } from "../domain/sheet.ts";
import { consoleTrait } from "../domain/stats.ts";
import {
  emptyVector,
  isKnownStat,
  slotOf,
  SLOT_COUNT,
  STAT_SLOTS,
  type StatId,
} from "../domain/statvec.ts";
import { equipmentOf, heldByOthers, resolveCharacter } from "../db/store.ts";
import { createSolverHost, CancelledError, type SolveHandle } from "../solver/host.ts";
import type { JobProgress, JobResult, SolveJob } from "../solver/job.ts";
import { esperFor, type LoadedData } from "../state/gamedata.ts";
import { Board } from "./Board.tsx";
import { ItemCard } from "./ItemCard.tsx";
import { Icon } from "./Icon.tsx";
import { useAppState, useStore } from "./useStore.ts";

const DEFAULT_TARGETS: StatTarget[] = [
  { stat: "CritBase", target: 0.7, weight: 3 },
  { stat: "CritDamageBase", target: 2.0, weight: 3 },
  { stat: "AtkUp", target: 0.5, weight: 2 },
  { stat: "UnbalIntensityBase", target: 280, weight: 1 },
];

export function CharacterView({
  data,
  characterId,
}: {
  data: LoadedData;
  characterId: string;
}) {
  const store = useStore();
  const state = useAppState();
  const db = state.data.db;

  const character = db.characters.find((row) => row.characterId === characterId);
  const esper = esperFor(data.gamedata, characterId);

  const guide = guideFor(data.guides, characterId);
  // Defaults to Prydwen on every page load, as specified - but a character with
  // no published guide has nothing to default to, so it starts on Custom.
  const [useCustom, setUseCustom] = useState(() => guide === null);
  const [variantName, setVariantName] = useState<string | null>(
    guide?.variants[0]?.name ?? null,
  );

  const [customTargets, setTargets] = useState<StatTarget[]>(() => {
    const stored = character?.customTargets;
    if (!stored?.length) return DEFAULT_TARGETS;
    return stored
      .filter((entry) => isKnownStat(entry.stat))
      .map((entry) => ({ stat: entry.stat as StatId, target: entry.target, weight: entry.weight }));
  });
  const variant = variantFor(guide, variantName);
  // Switching back to Prydwen does not discard what was customised.
  const targets = useCustom || !variant ? customTargets : targetsFromGuide(variant);

  const [arcId, setArcId] = useState<string | null>(character?.arcId ?? null);
  const [arcLevel, setArcLevel] = useState(MAX_ARC_LEVEL);
  const [refinement, setRefinement] = useState(Math.max(character?.arcRefinement ?? 1, 1));
  const [arcToggles, setArcToggles] = useState<Record<number, boolean | number>>(
    () => (character?.effectToggles as Record<number, boolean | number>) ?? {},
  );
  const [result, setResult] = useState<JobResult | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // R2. Off by default: taking gear off another character is a real cost, so it
  // is opted into rather than assumed.
  const [useEquipped, setUseEquipped] = useState(false);
  const handle = useRef<SolveHandle | null>(null);

  const worn = equipmentOf(db, characterId);

  const arc = arcId ? data.gamedata.arcs.find((entry) => entry.id === arcId) : undefined;
  // The Arc is part of the character's base, not part of the gear pool: it
  // contributes flat ATK and one stat line before any module is placed.
  const arcResult = useMemo(
    () =>
      arc
        ? arcContribution(arc, data.gamedata.arcEffects[arc.id], {
            arcId: arc.id,
            level: arcLevel,
            refinement,
            toggles: arcToggles,
          })
        : null,
    [arc, data.gamedata.arcEffects, arcLevel, refinement, arcToggles],
  );
  const build = result?.assignment[0]?.build ?? null;

  const board = useMemo(() => (esper ? boardFromSlots(esper.slots) : null), [esper]);

  if (!esper || !board) {
    return (
      <section>
        <h2>{characterId}</h2>
        {/* Seven codenames have no everness counterpart at all. */}
        <p className="warning">
          No game data for this codename, so there is no console grid, stat curve or artwork for
          it. Its gear still appears in the item tabs.
        </p>
      </section>
    );
  }

  const trait = consoleTrait(esper);

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
      characters: [
        {
          key: characterId,
          slots: esper.slots,
          trait,
          base: arcResult ? Array.from(arcResult.vector) : new Array(SLOT_COUNT).fill(0),
          scoring: { targets },
          excludedInstances: useEquipped ? [] : heldByOthers(db, [characterId]),
        },
      ],
      options: { rounds: 0 },
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

  // The solve's own packing decides the cells; a captured loadout carries them
  // only when the capture did.
  const placement = build
    ? build.tiling.placement
    : board.cells.map((cell) => worn.findIndex((row) => row.cells?.includes(cell)));
  const cells = build ? build.tiling.cells : board.cells;
  const pieces = build ? build.tiling.pieces.length : Math.max(worn.length, 1);

  const itemFor = (piece: number) => {
    if (!build) {
      const row = worn[piece];
      return row ? db.items.find((item) => item.instance === row.instance) : undefined;
    }
    const index = build.modules[piece];
    return index === undefined ? undefined : db.items[index];
  };

  const report = build ? explain(build.vector, compile({ targets })) : null;

  // The sheet reflects what the character would actually have: the solved build
  // when there is one, otherwise the Arc alone plus what they are wearing.
  const sheetTotal = useMemo(() => {
    if (build) return build.vector;
    const total = arcResult ? new Float32Array(arcResult.vector) : emptyVector();
    for (const row of worn) {
      const item = db.items.find((entry) => entry.instance === row.instance);
      if (!item) continue;
      for (const stat of [...item.mainStats, ...item.substats]) {
        if (stat.value === null) continue;
        const slot = slotOf(stat.stat);
        if (slot >= 0) total[slot] = total[slot]! + stat.value;
      }
    }
    return total;
  }, [build, arcResult, worn, db.items]);

  const sheet = compareSheet(
    predictSheet(esper, character?.level ?? null, sheetTotal),
    character?.measuredSheet,
  );

  return (
    <section className="character">
      <h2 className="card-head">
        <Icon entry={`esper:${characterId}`} alt={esper.name} size={56} />
        {esper.name}{" "}
        <span className="dim">
          level {character?.level ?? "?"} · {character?.breakthroughs ?? "?"} breakthroughs
        </span>
      </h2>
      <p className="dim">
        {esper.element} · console trait{" "}
        {trait
          ? `${trait.name} +${trait.per} per Type ${trait.moduleCells === 2 ? "II" : "III"}`
          : "none"}
      </p>

      <div className="arc-row">
        <label className="arc">
          Arc
          <select value={arcId ?? ""} onChange={(event) => setArcId(event.target.value || null)}>
            <option value="">none</option>
            {data.gamedata.arcs.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        {arc && (
          <>
            <label className="arc">
              Level
              <input
                type="number"
                min={1}
                max={MAX_ARC_LEVEL}
                value={arcLevel}
                onChange={(event) => setArcLevel(Number(event.target.value))}
              />
            </label>
            <label className="arc">
              Refinement
              <input
                type="number"
                min={1}
                max={MAX_REFINEMENT}
                value={refinement}
                onChange={(event) => setRefinement(Number(event.target.value))}
              />
            </label>
          </>
        )}
      </div>

      {arc && (
        <ArcEffects
          controls={arcControls(arc, data.gamedata.arcEffects[arc.id])}
          toggles={arcToggles}
          onChange={setArcToggles}
          omitted={arcResult?.omitted ?? []}
        />
      )}

      <div className="source-toggle">
        <button
          className={useCustom ? "" : "active"}
          disabled={guide === null}
          onClick={() => setUseCustom(false)}
        >
          Prydwen
        </button>
        <button className={useCustom ? "active" : ""} onClick={() => setUseCustom(true)}>
          Custom
        </button>
        {guide && !useCustom && guide.variants.length > 1 && (
          <select
            value={variantName ?? ""}
            onChange={(event) => setVariantName(event.target.value)}
          >
            {guide.variants.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
        {guide === null && (
          <span className="dim">
            No published guide for this character — see RESUME.md on why guide data is not
            scraped.
          </span>
        )}
      </div>

      {useCustom || !variant ? (
        <TargetEditor targets={customTargets} onChange={setTargets} />
      ) : (
        <ReadOnlyTargets targets={targets} source={guide!.source} updated={guide!.updated} />
      )}

      <label className="toggle">
        <input
          type="checkbox"
          checked={useEquipped}
          onChange={(event) => setUseEquipped(event.target.checked)}
        />
        Use items other characters are wearing
      </label>

      <div className="actions">
        <button disabled={running} onClick={() => void solve()}>
          Calculate
        </button>
        <button disabled={!running} onClick={() => handle.current?.cancel()}>
          Stop
        </button>
        {build && (
          <button
            onClick={() => {
              const instances = [build.cartridge, ...build.modules]
                .map((index) => db.items[index]?.instance)
                .filter((instance) => instance !== undefined);
              const cellsByInstance: Record<string, number[]> = {};
              build.modules.forEach((index, piece) => {
                const instance = db.items[index]?.instance;
                if (!instance) return;
                cellsByInstance[instance] = build.tiling.cells.filter(
                  (_cell, position) => build.tiling.placement[position] === piece,
                );
              });
              void store.equip(characterId, instances, { cells: cellsByInstance });
            }}
          >
            Equip this build
          </button>
        )}
      </div>

      {running && progress && (
        <p className="dim">
          {progress.phase === "portfolio"
            ? `${progress.done} / ${progress.total} packings`
            : `round ${progress.round}`}
        </p>
      )}
      {problem && <p className="problem">{problem}</p>}
      {result?.unbuildable.includes(characterId) && (
        <p className="warning">No valid full-set build exists for this character and pool.</p>
      )}

      <Board
        cells={cells}
        placement={placement}
        pieces={pieces}
        onHover={setHovered}
        labelFor={(piece) => {
          const item = itemFor(piece);
          return item ? `${item.shape ?? item.set} +${item.level}` : "";
        }}
      />

      {hovered !== null && hovered >= 0 && (
        <ItemCard item={itemFor(hovered)} db={db} />
      )}

      <SheetPanel
        sheet={sheet}
        measured={character?.measuredSheet ?? null}
        onSave={(next) => void store.setMeasuredSheet(characterId, next)}
      />

      {build && (
        <div className="result">
          <p className="dim">
            score {build.score.toFixed(4)} ·{" "}
            {build.proven
              ? "optimal for this packing and cartridge"
              : "best found, not proved optimal"}
          </p>
          {build.unknownTiers.length > 0 && (
            <p className="warning">
              Set bonus tier {build.unknownTiers.join(" and ")} is active but its values have
              never been measured, so it contributes nothing to this score.
            </p>
          )}
          {report && (
            <table className="items">
              <tbody>
                {report.stats.map((stat) => (
                  <tr key={stat.stat}>
                    <td>{stat.stat}</td>
                    <td>{stat.value.toFixed(3)}</td>
                    <td className="dim">/ {stat.target}</td>
                    <td>
                      <div className="bar">
                        <div style={{ width: `${stat.attainment * 100}%` }} />
                      </div>
                    </td>
                    <td className="dim">{(stat.attainment * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function TargetEditor({
  targets,
  onChange,
}: {
  targets: StatTarget[];
  onChange: (next: StatTarget[]) => void;
}) {
  return (
    <details className="targets">
      <summary>Targets and weights</summary>
      <p className="dim">
        Targets are a floor to reach, not a ceiling: each stat stops earning once it is met, so
        the shortfall falls on the lowest-weighted stats.
      </p>
      {targets.map((entry, index) => (
        <div key={entry.stat} className="target-row">
          <select
            value={entry.stat}
            onChange={(event) => {
              const next = [...targets];
              next[index] = { ...entry, stat: event.target.value as StatId };
              onChange(next);
            }}
          >
            {STAT_SLOTS.map((stat) => (
              <option key={stat} value={stat}>
                {stat}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="any"
            value={entry.target}
            onChange={(event) => {
              const next = [...targets];
              next[index] = { ...entry, target: Number(event.target.value) };
              onChange(next);
            }}
          />
          <input
            type="number"
            min={0}
            value={entry.weight}
            onChange={(event) => {
              const next = [...targets];
              next[index] = { ...entry, weight: Number(event.target.value) };
              onChange(next);
            }}
          />
          <button onClick={() => onChange(targets.filter((_, i) => i !== index))}>remove</button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([
            ...targets,
            { stat: STAT_SLOTS.find((stat) => !targets.some((t) => t.stat === stat))!, target: 1, weight: 1 },
          ])
        }
      >
        add a stat
      </button>
    </details>
  );
}


/**
 * Controls for an Arc's conditional effects.
 *
 * The control follows the classification, never the effect text: `toggle` is a
 * checkbox, `stacks` is a count. Anything classified `duration` or
 * `unmodellable` gets no control and is listed as left out, because a build that
 * silently assumed a conditional buff was active would read as a better build
 * than it is.
 */
function ArcEffects({
  controls,
  toggles,
  onChange,
  omitted,
}: {
  controls: ReturnType<typeof arcControls>;
  toggles: Record<number, boolean | number>;
  onChange: (next: Record<number, boolean | number>) => void;
  omitted: Array<{ placeholder: number; mode: string; why: string }>;
}) {
  const skipped = omitted.filter(
    (entry) => entry.mode === "duration" || entry.mode === "unmodellable",
  );
  return (
    <details className="targets">
      <summary>Arc effects</summary>
      {controls.length === 0 && <p className="dim">Nothing on this Arc is conditional.</p>}
      {controls.map((control) =>
        control.mode === "toggle" ? (
          <label key={control.placeholder} className="target-row">
            <input
              type="checkbox"
              checked={toggles[control.placeholder] === true}
              onChange={(event) =>
                onChange({ ...toggles, [control.placeholder]: event.target.checked })
              }
            />
            {control.stat} <span className="dim">{control.why}</span>
          </label>
        ) : (
          <label key={control.placeholder} className="target-row">
            <input
              type="number"
              min={0}
              value={Number(toggles[control.placeholder] ?? 0)}
              onChange={(event) =>
                onChange({ ...toggles, [control.placeholder]: Number(event.target.value) })
              }
            />
            {control.stat} stacks <span className="dim">{control.why}</span>
          </label>
        ),
      )}
      {skipped.length > 0 && (
        <p className="dim">
          Not modelled: {skipped.map((entry) => entry.why).join("; ")}
        </p>
      )}
    </details>
  );
}

/**
 * Predicted against what the game actually shows.
 *
 * Permanent rather than a debug view. The stat model was solved against one
 * character's sheet and has measured gaps, so the only honest way to ship it is
 * to keep the comparison in front of the player: drift then gets noticed by
 * whoever can see the real number, instead of quietly skewing every build.
 */
function SheetPanel({
  sheet,
  measured,
  onSave,
}: {
  sheet: ReturnType<typeof compareSheet>;
  measured: Record<string, number> | null;
  onSave: (next: Record<string, number> | null) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(measured ?? {}).map(([key, value]) => [key, String(value)])),
  );
  const drifted = sheet.filter((line) => line.drifted);

  return (
    <details className="targets sheet" open={drifted.length > 0}>
      <summary>
        Predicted vs actual sheet
        {drifted.length > 0 && (
          <span className="warning"> — {drifted.length} disagree</span>
        )}
      </summary>
      <p className="dim">
        Read these with the character <strong>off the active team</strong>. On field an Arc&apos;s
        conditional effects are folded into the numbers and cannot be separated from gear.
      </p>
      <table className="items">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Predicted</th>
            <th>In game</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          {sheet.map((line) => (
            <tr key={line.key} className={line.drifted ? "row--drifted" : ""}>
              <td>{line.label}</td>
              <td>
                {line.predicted === null ? (
                  <span className="warning" title={line.unavailable}>
                    unavailable
                  </span>
                ) : line.percent ? (
                  `${(line.predicted * 100).toFixed(2)}%`
                ) : (
                  line.predicted.toFixed(0)
                )}
              </td>
              <td>
                <input
                  type="number"
                  step="any"
                  value={draft[line.key] ?? ""}
                  placeholder={line.percent ? "0.00" : "—"}
                  onChange={(event) => setDraft({ ...draft, [line.key]: event.target.value })}
                />
              </td>
              <td className={line.drifted ? "warning" : "dim"}>
                {line.delta === null
                  ? "—"
                  : line.percent
                    ? `${(line.delta * 100).toFixed(2)}%`
                    : line.delta.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button
          onClick={() => {
            const next: Record<string, number> = {};
            for (const [key, value] of Object.entries(draft)) {
              const parsed = Number(value);
              if (value.trim() !== "" && Number.isFinite(parsed)) next[key] = parsed;
            }
            onSave(Object.keys(next).length > 0 ? next : null);
          }}
        >
          Save readings
        </button>
        <button
          onClick={() => {
            setDraft({});
            onSave(null);
          }}
        >
          Clear
        </button>
      </div>
      {drifted.length > 0 && (
        <p className="warning">
          The model disagrees with the game on {drifted.map((line) => line.label).join(", ")}.
          That is a bug in the stat model, not in your gear — worth recording before trusting a
          build.
        </p>
      )}
    </details>
  );
}

/** Published targets, rendered read-only: they are a citation, not a setting. */
function ReadOnlyTargets({
  targets,
  source,
  updated,
}: {
  targets: StatTarget[];
  source: string;
  updated: string;
}) {
  return (
    <details className="targets" open>
      <summary>
        Targets and weights <span className="dim">from {source}, {updated}</span>
      </summary>
      <p className="dim">
        Weights come from the published substat ranking, so a shortfall lands on the
        lowest-ranked stats. Switch to Custom to change any of it.
      </p>
      <table className="items">
        <tbody>
          {targets.map((entry) => (
            <tr key={entry.stat}>
              <td>{entry.stat}</td>
              <td>{entry.target}</td>
              <td className="dim">weight {entry.weight.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

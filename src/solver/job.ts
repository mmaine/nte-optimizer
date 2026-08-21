/**
 * A whole team solve as one serialisable value.
 *
 * The worker boundary only carries structured-cloneable data, so the job holds
 * plain arrays and configuration - never a callback, a `Map`, or a prebuilt
 * pool. Everything derived is rebuilt inside `runJob`, which means the inline
 * host and the worker host run byte-identical code and cannot drift.
 */
import { boardFromSlots, boardKey } from "../domain/board.ts";
import type { SetName } from "../domain/cartridges.ts";
import { buildPool, type ExportedItem } from "../domain/items.ts";
import { compile, type ScoringConfig } from "../domain/scoring.ts";
import type { SetBonusTable } from "../domain/setbonus.ts";
import type { ConsoleTrait } from "../domain/stats.ts";
import { SLOT_COUNT } from "../domain/statvec.ts";
import { loadTilings, type RawTilings, type Tiling } from "../domain/tilings.ts";
import { diversify, type Portfolio } from "./portfolio.ts";
import type { Build } from "./protocol.ts";
import { solveSingle } from "./single.ts";
import { solveTeam, type TeamAssignment } from "./team.ts";

export interface CharacterJob {
  key: string;
  /** The character's console grid, 7x7 with -1 blocked. */
  slots: number[][];
  trait: ConsoleTrait | null;
  /** Contributions before gear, as a plain array of `SLOT_COUNT` numbers. */
  base: number[];
  scoring: ScoringConfig;
  /** Restrict to these sets. Omit for every set the account owns. */
  sets?: SetName[];
  /**
   * Instances this character may not use - R2's "use equipped items" toggle
   * turned off, meaning items another character is wearing are off limits.
   *
   * Carried as instance ids rather than pool indices because the job crosses a
   * worker boundary and the pool is rebuilt on the other side.
   */
  excludedInstances?: string[];
}

export interface SolveJob {
  items: ExportedItem[];
  characters: CharacterJob[];
  setBonuses: SetBonusTable;
  tilings: RawTilings;
  dragOrder?: string[];
  options?: {
    beamWidth?: number;
    candidateWidth?: number;
    perTilingKeep?: number;
    portfolioSize?: number;
    rounds?: number;
  };
}

export type JobProgress =
  | { phase: "portfolio"; character: string; done: number; total: number }
  | { phase: "team"; round: number; rounds: number; sorted: number[] };

export interface JobResult {
  assignment: TeamAssignment[];
  sorted: number[];
  unbuildable: string[];
  infeasible: boolean;
  rounds: number;
  /** Item ids the export carried that this build has no shape for. */
  unknownShapes: string[];
}

/**
 * Defaults measured on the real 817-item pool: beam 60 with 12 candidates finds
 * the same best builds as beam 200 with 20 while running about seven times
 * faster, and four characters then solve in a few seconds rather than half a
 * minute.
 */
const DEFAULTS = {
  beamWidth: 60,
  candidateWidth: 12,
  perTilingKeep: 6,
  portfolioSize: 300,
  rounds: 6,
};

export function* runJob(job: SolveJob): Generator<JobProgress, JobResult, void> {
  const options = { ...DEFAULTS, ...job.options };
  const pool = buildPool(job.items);
  const tables = loadTilings(job.tilings);

  const tilingsFor = (character: CharacterJob): Tiling[] => {
    const key = boardKey(boardFromSlots(character.slots));
    const table = tables.find((entry) => entry.cells.join(",") === key);
    if (!table) return [];
    const wanted = character.sets;
    const lists = wanted
      ? wanted.map((set) => table.bySet.get(set) ?? [])
      : [...table.bySet.values()];
    return lists.flat();
  };

  const baseVector = (character: CharacterJob): Float32Array => {
    const vector = new Float32Array(SLOT_COUNT);
    vector.set(character.base.slice(0, SLOT_COUNT));
    return vector;
  };

  const indexOfInstance = new Map(pool.items.map((item, index) => [item.instance, index]));
  const excludedFor = (character: CharacterJob): Set<number> => {
    const out = new Set<number>();
    for (const instance of character.excludedInstances ?? []) {
      const index = indexOfInstance.get(instance);
      if (index !== undefined) out.add(index);
    }
    return out;
  };

  const solveOne = function* (
    character: CharacterJob,
    extraExcluded: ReadonlySet<number>,
  ): Generator<JobProgress, Build[], void> {
    // The character's own restriction always applies; column generation adds
    // whatever the rest of the team is currently holding on top of it.
    const excluded = excludedFor(character);
    for (const index of extraExcluded) excluded.add(index);

    const run = solveSingle({
      pool,
      tilings: tilingsFor(character),
      base: baseVector(character),
      trait: character.trait,
      setBonuses: job.setBonuses,
      scoring: compile(character.scoring),
      excluded,
      beamWidth: options.beamWidth,
      candidateWidth: options.candidateWidth,
      perTilingKeep: options.perTilingKeep,
    });
    let step = run.next();
    while (!step.done) {
      yield {
        phase: "portfolio",
        character: character.key,
        done: step.value.done,
        total: step.value.total,
      };
      step = run.next();
    }
    return step.value.portfolio;
  };

  // --- phase 0 ----------------------------------------------------------
  const portfolios: Portfolio[] = [];
  for (const character of job.characters) {
    const builds = yield* solveOne(character, new Set());
    const entries = diversify(builds, pool.items.length, options.portfolioSize);
    portfolios.push({ key: character.key, entries, unbuildable: entries.length === 0 });
  }

  // --- phases 1 and 2 ---------------------------------------------------
  //
  // Column generation re-solves synchronously: `solveTeam` takes a plain
  // function, so the re-solve cannot yield progress of its own. That is a
  // deliberate trade - the alternative is threading a generator through the
  // leximin search for a step that already takes well under a second.
  const byKey = new Map(job.characters.map((character) => [character.key, character]));
  const resolve = (key: string, excluded: ReadonlySet<number>): Build[] => {
    const character = byKey.get(key);
    if (!character) return [];
    const run = solveOne(character, excluded);
    let step = run.next();
    while (!step.done) step = run.next();
    return step.value.slice(0, 40);
  };

  const team = solveTeam({
    portfolios,
    poolSize: pool.items.length,
    dragOrder: job.dragOrder ?? job.characters.map((character) => character.key),
    resolve,
    rounds: options.rounds,
  });

  let step = team.next();
  while (!step.done) {
    yield {
      phase: "team",
      round: step.value.round,
      rounds: step.value.rounds,
      sorted: step.value.sorted,
    };
    step = team.next();
  }

  const result = step.value;
  return {
    assignment: result.assignment,
    sorted: result.sorted,
    unbuildable: result.unbuildable,
    infeasible: result.infeasible,
    rounds: result.rounds,
    unknownShapes: pool.unknownShapes,
  };
}

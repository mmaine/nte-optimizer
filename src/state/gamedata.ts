/**
 * The generated game data.
 *
 * Loaded through a dynamic import so Vite emits it as a content-hashed chunk -
 * immutable-cacheable, and off the first-paint path. It stays a plain module
 * rather than a `fetch` precisely so the single-file build can inline it;
 * `fetch` could not be.
 */
import type { RawTilings } from "../domain/tilings.ts";
import type { SetBonusTable } from "../domain/setbonus.ts";
import type { GuideTable } from "../domain/guides.ts";

export interface Esper {
  id: number;
  abilityKey: string;
  name: string;
  element: string | null;
  rarity: number;
  icon: string;
  stats: Array<{ id_stats: string; name: string; bShowPercent: boolean; values: number[] }>;
  slots: number[][];
  ownerGridCount: number;
  trait: Array<{ id_stats: string; name: string; bShowPercent: boolean; value: number }>;
  breakthroughLevels: number[];
}

export interface Arc {
  id: string;
  name: string;
  icon: string;
  quality: number;
  desc: string;
  stats: unknown;
  values: unknown;
}

export type ArcEffectMode = "always" | "stacks" | "toggle" | "duration" | "unmodellable";

export interface ArcEffect {
  placeholder: number;
  stat: string | null;
  percent?: boolean;
  mode: ArcEffectMode;
  default?: boolean;
  why: string;
}

export interface GameData {
  format: string;
  format_version: number;
  generated: string;
  espers: Esper[];
  arcs: Arc[];
  arcEffects: Record<string, { name: string; effects: ArcEffect[] }>;
}

export interface LoadedData {
  gamedata: GameData;
  tilings: RawTilings;
  setBonuses: SetBonusTable;
  guides: GuideTable;
}

let cached: Promise<LoadedData> | null = null;

export function loadGameData(): Promise<LoadedData> {
  cached ??= (async () => {
    const [gamedata, tilings, setBonuses, guides] = await Promise.all([
      import("../generated/gamedata.json"),
      import("../generated/tilings.json"),
      import("../../data-src/set-bonuses.json"),
      import("../../data-src/guides.json"),
    ]);
    return {
      gamedata: (gamedata.default ?? gamedata) as unknown as GameData,
      tilings: (tilings.default ?? tilings) as unknown as RawTilings,
      setBonuses: (setBonuses.default ?? setBonuses) as unknown as SetBonusTable,
      guides: (guides.default ?? guides) as unknown as GuideTable,
    };
  })();
  return cached;
}

/** The esper whose ability key a capture used, or null for a codename with no record. */
export function esperFor(data: GameData, characterId: string): Esper | null {
  return data.espers.find((esper) => esper.abilityKey === characterId) ?? null;
}

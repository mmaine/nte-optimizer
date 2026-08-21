/**
 * Prunes the mirrored everness data down to what the app actually needs.
 *
 * Input  data-src/{espers,arcs,arc_effects}.json  (committed, not shipped)
 * Output src/generated/gamedata.json              (committed, bundled)
 *
 * Everything dropped here is presentation the app never renders: voice lines,
 * fashion, profile text, and the ability descriptions. What stays is the stat
 * curves, the console grid, the console trait, and the ids that join to a
 * capture.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) =>
  JSON.parse(readFileSync(join(root, "data-src", name), "utf8"));

interface StatCurve {
  id_stats: string;
  name: string;
  bShowPercent: boolean;
  values: number[];
}

interface TraitStat {
  id_stats: string;
  name: string;
  bShowPercent: boolean;
  value: number;
}

export interface Esper {
  id: number;
  /** The `GA_<key>_*` name the capture marks character blocks with. */
  abilityKey: string;
  name: string;
  element: string | null;
  rarity: number;
  icon: string;
  /** Per-level curves, indexed by level - 1. */
  stats: StatCurve[];
  /** 7x7, -1 blocked and 0 free. */
  slots: number[][];
  /**
   * The module type the console trait keys off - 2 or 3, NOT the grid type.
   * Prydwen's "Console Grid Type" means this same number.
   */
  ownerGridCount: number;
  /** Never assume Type III / CRIT DMG: seven different stats appear here. */
  trait: TraitStat[];
  /** Levels at which a breakthrough is taken. */
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

const espersRaw = read("espers.json") as any[];
const arcsRaw = read("arcs.json") as Record<string, any> | any[];
const arcEffects = read("arc_effects.json") as Record<string, unknown>;

function abilityKey(esper: any): string {
  const id: string | undefined = esper?.melee?.[0]?.id;
  const match = /^GA_(.+?)_Melee$/.exec(id ?? "");
  if (!match) throw new Error(`no GA_<key>_Melee id on esper ${esper?.name}`);
  return match[1]!;
}

const espers: Esper[] = espersRaw.map((esper) => ({
  id: esper.id,
  abilityKey: abilityKey(esper),
  name: esper.name,
  element: esper.element?.[0]?.element_id ?? null,
  rarity: esper.rarity,
  icon: esper.icon,
  stats: (esper.stats ?? []).map((stat: StatCurve) => ({
    id_stats: stat.id_stats,
    name: stat.name,
    bShowPercent: stat.bShowPercent,
    values: stat.values,
  })),
  slots: esper.equip_slots.slots,
  ownerGridCount: esper.equip_slots.OwnerGridCount,
  trait: (esper.equip_slots.stats ?? []).map((stat: TraitStat) => ({
    id_stats: stat.id_stats,
    name: stat.name,
    bShowPercent: stat.bShowPercent,
    value: stat.value,
  })),
  breakthroughLevels: (esper.breakthrough ?? []).map((step: { level: string }) =>
    Number(step.level),
  ),
}));

const arcEntries = Array.isArray(arcsRaw) ? arcsRaw : Object.values(arcsRaw);
const arcs: Arc[] = arcEntries.map((arc: any) => ({
  id: arc.id,
  name: arc.name,
  icon: arc.icon,
  quality: arc.quality,
  desc: arc.desc,
  stats: arc.stats,
  values: arc.effect?.values ?? arc.effect ?? null,
}));

const gamedata = {
  format: "nte-gamedata",
  format_version: 1,
  generated: new Date().toISOString().slice(0, 10),
  espers,
  arcs,
  arcEffects,
};

const outDir = join(root, "src", "generated");
mkdirSync(outDir, { recursive: true });
const json = JSON.stringify(gamedata);
writeFileSync(join(outDir, "gamedata.json"), json + "\n");

const sourceBytes = ["espers.json", "arcs.json"].reduce(
  (total, name) => total + readFileSync(join(root, "data-src", name)).byteLength,
  0,
);
console.log(
  `gamedata.json  ${espers.length} espers, ${arcs.length} arcs  ` +
    `${(sourceBytes / 1024).toFixed(0)} KB -> ${(json.length / 1024).toFixed(0)} KB`,
);

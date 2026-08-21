/**
 * Validates `data-src/guides.json`.
 *
 * There is deliberately **no scraper**. Prydwen's character pages are
 * client-rendered, so a plain fetch returns navigation chrome, and their Gatsby
 * data endpoint answers `410 Gone`. Their robots.txt does allow content pages
 * with a ten second crawl-delay, so a headless render would be within policy -
 * but it is not something an unattended build step should be doing, and the plan
 * always called for this file to be human-reviewed and committed.
 *
 * So the tool checks what a person typed instead: that every stat id has a slot,
 * that targets look like the units the model expects, and that keys join to real
 * characters.
 *
 *   node --experimental-strip-types tools/check-guides.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { GuideTable } from "../src/domain/guides.ts";
import { isKnownStat } from "../src/domain/statvec.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const guides = JSON.parse(
  readFileSync(join(root, "data-src/guides.json"), "utf8"),
) as GuideTable;
const gamedata = JSON.parse(readFileSync(join(root, "src/generated/gamedata.json"), "utf8"));
const keys = new Set<string>(
  gamedata.espers.map((esper: { abilityKey: string }) => esper.abilityKey),
);

const problems: string[] = [];

if (guides.format !== "nte-guides") problems.push(`wrong format: ${guides.format}`);

for (const guide of guides.characters ?? []) {
  const where = `${guide.key}`;
  if (!keys.has(guide.key)) {
    // Seven codenames have no everness record, so this is a warning about a
    // typo, not proof the character does not exist.
    problems.push(`${where}: not an ability key in gamedata (typo, or a codename with no record)`);
  }
  if (!guide.variants?.length) problems.push(`${where}: no variants`);

  for (const variant of guide.variants ?? []) {
    const scope = `${where}/${variant.name}`;
    if (!variant.name) problems.push(`${scope}: variant has no name`);

    for (const stat of variant.priority ?? []) {
      if (!isKnownStat(stat)) problems.push(`${scope}: priority stat has no slot: ${stat}`);
    }
    if (new Set(variant.priority ?? []).size !== (variant.priority ?? []).length) {
      problems.push(`${scope}: a stat appears twice in the priority list`);
    }

    for (const target of variant.targets ?? []) {
      if (!isKnownStat(target.stat)) {
        problems.push(`${scope}: target stat has no slot: ${target.stat}`);
        continue;
      }
      if (!Number.isFinite(target.target) || target.target <= 0) {
        problems.push(`${scope}: ${target.stat} has a non-positive target`);
      }
      // Percentages are fractions here, never "70". A target above 5 on a
      // percentage stat is almost certainly a units mistake.
      const isPercent =
        target.stat.endsWith("Up") ||
        target.stat === "CritBase" ||
        target.stat === "CritDamageBase" ||
        target.stat.startsWith("DamageUp");
      if (isPercent && target.target > 5) {
        problems.push(
          `${scope}: ${target.stat} target ${target.target} looks like a percent, not a fraction`,
        );
      }
    }
  }
}

const count = guides.characters?.length ?? 0;
if (problems.length > 0) {
  console.error(`guides.json: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  count === 0
    ? "guides.json is valid and empty - the app will say no published guide is available"
    : `guides.json is valid: ${count} character(s)`,
);

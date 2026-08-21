/**
 * Downloads character and Arc artwork once, at build time.
 *
 * everness is never hotlinked at runtime: the app would break the moment their
 * paths changed or their CORS policy tightened, and it would be rude besides.
 * Files land in `public/img/` named by a content hash, so they can be served
 * `immutable` and a changed icon gets a new name for free.
 *
 * The single-file `file://` build does not carry these - inlining 72 images
 * would multiply its size for decoration. Cards fall back to the character's
 * name there, which is the information that actually matters.
 *
 *   node --experimental-strip-types tools/fetch-icons.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "img");
const BASE = "https://everness.info/images";

interface Entry {
  key: string;
  path: string;
}

const gamedata = JSON.parse(readFileSync(join(root, "src/generated/gamedata.json"), "utf8"));

const entries: Entry[] = [
  ...gamedata.espers.map((esper: { abilityKey: string; icon: string }) => ({
    key: `esper:${esper.abilityKey}`,
    path: esper.icon,
  })),
  ...gamedata.arcs.map((arc: { id: string; icon: string }) => ({
    key: `arc:${arc.id}`,
    path: arc.icon,
  })),
].filter((entry) => typeof entry.path === "string" && entry.path.length > 0);

mkdirSync(outDir, { recursive: true });
// Rebuilt wholesale, so a renamed icon cannot leave an orphan behind.
for (const name of readdirSync(outDir)) rmSync(join(outDir, name));

const manifest: Record<string, string> = {};
let bytes = 0;
let failed = 0;

for (const entry of entries) {
  const url = `${BASE}${entry.path}.webp`;
  try {
    const response = await fetch(url, { headers: { "user-agent": "nte-optimizer build" } });
    if (!response.ok) {
      failed += 1;
      console.warn(`  ${response.status} ${url}`);
      continue;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
    const slug = entry.path.split("/").pop() ?? "icon";
    const name = `${slug}-${hash}.webp`;
    writeFileSync(join(outDir, name), buffer);
    manifest[entry.key] = name;
    bytes += buffer.byteLength;
  } catch (error) {
    failed += 1;
    console.warn(`  failed ${url}: ${error instanceof Error ? error.message : error}`);
  }
}

writeFileSync(
  join(root, "src", "generated", "icons.json"),
  `${JSON.stringify({ format: "nte-icons", format_version: 1, files: manifest }, null, 1)}\n`,
);

console.log(
  `icons  ${Object.keys(manifest).length} of ${entries.length} fetched` +
    `${failed > 0 ? `, ${failed} failed` : ""}  ${(bytes / 1024).toFixed(0)} KB`,
);

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
/**
 * The asset host, and it is NOT the www host.
 *
 * `everness.info/...` answers **200 with `content-type: image/webp`** for paths
 * that do not exist, returning the SPA's HTML shell. An earlier version of this
 * script trusted that and wrote 72 HTML pages to disk named `.webp`; the app
 * silently rendered initials for months. Everything here is verified by magic
 * bytes, and a bad file is fatal rather than warned about.
 */
const BASE = "https://api.everness.info/data/assets";

/** everness paths are Unreal asset paths; the host serves them without `/Game/UI`. */
const assetUrl = (path: string): string =>
  `${BASE}${path.replace(/^\/Game\/UI/, "")}.webp`;

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.byteLength > 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

interface Entry {
  key: string;
  path: string;
}

const gamedata = JSON.parse(readFileSync(join(root, "src/generated/gamedata.json"), "utf8"));

type Esper = {
  abilityKey: string;
  icon: string;
  iconBig: string | null;
  iconGacha: string | null;
};

const entries: Entry[] = [
  // The 256px avatar is what the UI actually shows; `icon` is the small one and
  // is kept as the fallback for any esper without a big variant.
  ...gamedata.espers.map((esper: Esper) => ({
    key: `esper:${esper.abilityKey}`,
    path: esper.iconBig ?? esper.icon,
  })),
  // Full card art, used as the character view's header.
  ...gamedata.espers.map((esper: Esper) => ({
    key: `portrait:${esper.abilityKey}`,
    path: esper.iconGacha ?? "",
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
  const url = assetUrl(entry.path);
  try {
    const response = await fetch(url, { headers: { "user-agent": "nte-optimizer build" } });
    if (!response.ok) {
      failed += 1;
      console.warn(`  ${response.status} ${url}`);
      continue;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!isWebp(buffer)) {
      failed += 1;
      console.warn(`  not a webp (${buffer.byteLength} bytes) ${url}`);
      continue;
    }
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

// Fatal on purpose. A missing icon is cosmetic, but silently shipping a
// manifest that lost half its entries is how this broke the first time.
if (failed > 0) {
  throw new Error(`${failed} of ${entries.length} icons did not download as images`);
}

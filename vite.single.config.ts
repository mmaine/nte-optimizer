/**
 * The `file://` build: one HTML file, everything inlined.
 *
 * Chrome gives a `file://` document an opaque origin, which costs it IndexedDB,
 * workers, `fetch` and module scripts. So this build is a classic IIFE with the
 * game data inlined rather than dynamically imported, and the worker aliased out
 * entirely. The app degrades behind `PersistenceAdapter` and `SolverHost` and
 * never sees the difference.
 */
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const fromRoot = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

const OUT_DIR = "dist/single";
const TARGET = "dist/nte.html";

/** Fold the emitted script and stylesheet into one document. */
function inlineEverything(): Plugin {
  return {
    name: "inline-everything",
    writeBundle() {
      const files = readdirSync(OUT_DIR, { recursive: true }) as string[];
      const scripts = files.filter((name) => name.endsWith(".js"));
      const styles = files.filter((name) => name.endsWith(".css"));
      if (scripts.length !== 1) {
        // More than one chunk means something escaped `inlineDynamicImports`,
        // and a file:// page cannot fetch the second one.
        throw new Error(`expected one script, got ${scripts.length}: ${scripts.join(", ")}`);
      }
      const script = readFileSync(join(OUT_DIR, scripts[0]!), "utf8");
      const css = styles.map((name) => readFileSync(join(OUT_DIR, name), "utf8")).join("\n");

      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NTE gear optimizer</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${script}</script>
  </body>
</html>
`;
      writeFileSync(TARGET, html);
      rmSync(OUT_DIR, { recursive: true, force: true });
      const kb = (html.length / 1024).toFixed(0);
      // eslint-disable-next-line no-console
      console.log(`${TARGET}  ${kb} KB, one file, no external requests`);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), inlineEverything()],
  resolve: {
    // Matched against the whole import specifier and replaced with an absolute
    // path: a regex that rewrites only part of a relative specifier resolves
    // against the importer's directory and lands nowhere.
    alias: [
      {
        find: /^\.\/worker-host\.ts$/,
        replacement: fromRoot("src/solver/worker-host.single.ts"),
      },
      {
        // No artwork travels with the single file, so the manifest is emptied
        // rather than left to request images that are not there.
        find: /^\.\.\/generated\/icons\.json$/,
        replacement: fromRoot("src/generated/icons.empty.json"),
      },
    ],
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});

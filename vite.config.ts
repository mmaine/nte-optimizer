import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: './'` keeps the build working unchanged at [removed], under a
// plain `python3 -m http.server -d dist`, and inside the single-file build.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 4096,
    sourcemap: false,
  },
  worker: { format: "es" },
});

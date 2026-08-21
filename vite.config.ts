import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative assets keep the build portable across static hosts, local HTTP, and the single-file build.
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

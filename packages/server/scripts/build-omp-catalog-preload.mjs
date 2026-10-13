import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// The standalone kernel cannot resolve npm dependencies inside Electron's ASAR.
await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/server/agent/providers/omp/codex-catalog-preload.ts", import.meta.url),
    ),
  ],
  outfile: fileURLToPath(
    new URL("../dist/server/server/agent/providers/omp/codex-catalog-preload.js", import.meta.url),
  ),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2020",
});

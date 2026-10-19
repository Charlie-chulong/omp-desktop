import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const scriptPath = fileURLToPath(new URL("./run-electron-builder.mjs", import.meta.url));

describe("packaging runtime compatibility", () => {
  test.each([
    {
      runtime: { platform: "win32", arch: "x64" },
      args: ["--mac", "--arm64"],
      target: "darwin-arm64",
    },
    {
      runtime: { platform: "darwin", arch: "arm64" },
      args: ["--win", "--x64"],
      target: "win32-x64",
    },
    {
      runtime: { platform: "win32", arch: "x64" },
      args: ["--win", "--arm64"],
      target: "win32-arm64",
    },
    {
      runtime: { platform: "darwin", arch: "arm64" },
      args: ["--mac", "dmg:x64"],
      target: "darwin-x64",
    },
  ])(
    "rejects $target with a $runtime.platform-$runtime.arch runtime",
    ({ runtime, args, target }) => {
      const runtimeDist = mkdtempSync(path.join(os.tmpdir(), "omp-runtime-target-"));
      try {
        writeFileSync(
          path.join(runtimeDist, "version.json"),
          JSON.stringify({ ...runtime, electronApiVersion: "41.2.0" }),
        );
        const result = spawnSync(process.execPath, [scriptPath, ...args, "--publish", "never"], {
          cwd: path.resolve(path.dirname(scriptPath), ".."),
          encoding: "utf8",
          env: { ...process.env, MINI_ELECTRON_DIST_PATH: runtimeDist },
          timeout: 20_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(target);
        expect(result.stderr).toContain(`${runtime.platform}-${runtime.arch}`);
        expect(result.stderr).toContain(runtimeDist);
      } finally {
        rmSync(runtimeDist, { recursive: true, force: true });
      }
    },
  );
});

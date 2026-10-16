#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("@iriscat/mini-electron/package.json"));
const runtimeDist = process.env.MINI_ELECTRON_DIST_PATH || path.join(packageRoot, "dist");
const { miniElectron } = require("@iriscat/mini-electron/package.json");

if (!existsSync(runtimeDist)) {
  throw new Error(
    `mini-electron runtime is missing at ${runtimeDist}; reinstall without MINI_ELECTRON_SKIP_BINARY_DOWNLOAD`,
  );
}

const builderCli = require.resolve("electron-builder/cli.js");
const result = spawnSync(
  process.execPath,
  [
    builderCli,
    "--config",
    "electron-builder.yml",
    `--config.electronDist=${runtimeDist}`,
    `--config.electronVersion=${miniElectron.electronApiVersion}`,
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

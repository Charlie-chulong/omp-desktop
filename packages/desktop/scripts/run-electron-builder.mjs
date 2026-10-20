#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createYargs,
  configureBuildCommand,
  normalizeOptions,
} = require("electron-builder/out/builder");
const { Arch } = require("builder-util");
const args = process.argv.slice(2);
const options = configureBuildCommand(createYargs()).parseSync(args);
const packageRoot = path.dirname(require.resolve("@iriscat/mini-electron/package.json"));
const runtimeDist = path.resolve(
  process.env.MINI_ELECTRON_DIST_PATH || path.join(packageRoot, "dist"),
);

if (!existsSync(runtimeDist)) {
  throw new Error(
    `mini-electron runtime is missing at ${runtimeDist}; reinstall without MINI_ELECTRON_SKIP_BINARY_DOWNLOAD`,
  );
}

const runtime = JSON.parse(readFileSync(path.join(runtimeDist, "version.json"), "utf8"));
if (!["x64", "arm64"].includes(runtime.arch) || !runtime.electronApiVersion) {
  throw new Error(`Invalid mini-electron runtime metadata at ${runtimeDist}/version.json`);
}

// Match the installed runtime even when Node is running under Rosetta.
if (!["x64", "arm64", "ia32", "armv7l", "universal"].some((arch) => options[arch])) {
  options[runtime.arch] = true;
  args.unshift(`--${runtime.arch}`);
}

for (const [platform, arches] of normalizeOptions(options).targets) {
  for (const arch of arches.keys()) {
    if (platform.nodeName !== runtime.platform || Arch[arch] !== runtime.arch) {
      throw new Error(
        `Cannot package ${platform.nodeName}-${Arch[arch]} with the ` +
          `${runtime.platform}-${runtime.arch} runtime at ${runtimeDist}. ` +
          "Set MINI_ELECTRON_DIST_PATH to a distribution matching the target. " +
          "Published mini-electron targets: darwin-arm64 and win32-x64.",
      );
    }
  }
}

console.log(`Packaging with mini-electron ${runtime.platform}-${runtime.arch}: ${runtimeDist}`);

const builderCli = require.resolve("electron-builder/cli.js");
const result = spawnSync(
  process.execPath,
  [
    builderCli,
    "--config",
    "electron-builder.yml",
    `--config.electronDist=${runtimeDist}`,
    `--config.electronVersion=${runtime.electronApiVersion}`,
    ...args,
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

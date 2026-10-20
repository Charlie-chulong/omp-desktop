#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const target =
  args[0] && !args[0].startsWith("-")
    ? args.shift()
    : { darwin: "mac", win32: "windows" }[process.platform];

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run build:package -- [mac|windows] [electron-builder options]

With no target, package for the current OS.
mac:     macOS arm64, requires a Mac; produces DMG and ZIP.
windows: Windows x64; produces NSIS, ZIP and update metadata.
Output:  packages/desktop/release/
Local builds default to --publish never.`);
  process.exit(0);
}

if (target !== "mac" && target !== "windows") {
  throw new Error("Choose a supported packaging target: mac or windows.");
}
if (target === "mac" && process.platform !== "darwin") {
  throw new Error(
    "macOS packages must be built on macOS (Apple signing and DMG tools are required).",
  );
}

const nativeWindows = target === "windows" && process.platform === "win32";
const scriptPath = fileURLToPath(
  new URL(
    target === "mac"
      ? "../build-mac.sh"
      : nativeWindows
        ? "../build-windows.ps1"
        : "../build-windows.sh",
    import.meta.url,
  ),
);
const result = spawnSync(
  nativeWindows ? "powershell.exe" : "bash",
  [
    ...(nativeWindows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : []),
    scriptPath,
    ...args,
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

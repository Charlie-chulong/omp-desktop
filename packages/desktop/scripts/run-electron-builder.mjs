#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  build,
  coerceTypes,
  createYargs,
  configureBuildCommand,
  normalizeOptions,
} = require("electron-builder/out/builder");
const { getConfig } = require("app-builder-lib/out/util/config/config");
const { copyFiles, getFileMatchers } = require("app-builder-lib/out/fileMatcher");
const { resolveFunction } = require("app-builder-lib/out/util/resolve");
const { Arch } = require("builder-util");
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeVersions = { "win32-x64": "0.1.15", "darwin-arm64": "0.1.16" };

function deferQualifiedWindowsResources(config, projectDir) {
  const sealedDestinations = new Set(["bin/omp.exe", "bundled-omp-plugins", "manager.json"]);
  const sealedResources = [];
  for (const owner of [config, config.win]) {
    if (!Array.isArray(owner?.extraResources)) continue;
    owner.extraResources = owner.extraResources.filter((resource) => {
      if (!sealedDestinations.has(resource.to)) return true;
      sealedResources.push(resource);
      return false;
    });
  }
  if (sealedResources.length === 0) return;

  // These resources must not also enter the app-file copy/signing pass when an
  // alternative config uses broad files patterns.
  const appDir = path.resolve(projectDir, config.directories?.app ?? ".");
  const exclusions = sealedResources.flatMap(({ from }) => {
    const relative = path
      .relative(appDir, path.resolve(projectDir, from ?? "."))
      .replaceAll("\\", "/");
    return relative.startsWith("../") || path.isAbsolute(relative) ? [] : [`!${relative}{,/**/*}`];
  });
  let appFiles = config.files;
  if (!Array.isArray(appFiles)) appFiles = appFiles ? [appFiles] : ["**/*"];
  config.files = [...appFiles, ...exclusions];

  const originalAfterPack = config.afterPack;
  config.afterPack = async (context) => {
    // afterPack runs after the extra-file transformer. The subsequent Windows
    // signApp pass edits/signs the Desktop EXE, not these nested resources.
    const matchers = getFileMatchers(
      { extraResources: sealedResources },
      "extraResources",
      context.packager.getResourcesDir(context.appOutDir),
      context.packager.createGetFileMatchersOptions(context.outDir, context.arch, {}),
    );
    await copyFiles(matchers, null, false);
    let hook = originalAfterPack;
    if (typeof hook === "string") {
      hook = hook.startsWith(".")
        ? path.resolve(projectDir, hook)
        : createRequire(path.join(projectDir, "package.json")).resolve(hook);
    }
    hook = await resolveFunction(context.packager.appInfo.type, hook, "afterPack");
    if (hook) await hook(context);
  };
}

async function qualifyRuntime(runtimeDist, runtime, normalized) {
  for (const [platform, arches] of normalized.targets) {
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
  const target = `${runtime.platform}-${runtime.arch}`;
  const expectedVersion = runtimeVersions[target];
  if (!expectedVersion || runtime.runtimeVersion !== expectedVersion) {
    throw new Error(
      `Packaging ${target} requires mini-electron ${expectedVersion ?? "for a supported target"}; ` +
        `got ${runtime.runtimeVersion ?? "no runtime version"} at ${runtimeDist}. ` +
        "macOS mini-electron 0.1.16 is not a Windows runtime.",
    );
  }
  const executable =
    runtime.platform === "win32" ? "electron.exe" : "Electron.app/Contents/MacOS/Electron";
  const expectedHash = runtime.files?.[executable];
  if (runtime.installerProtocol !== 1 || !/^[a-f0-9]{64}$/.test(expectedHash ?? "")) {
    throw new Error(
      `Missing genuine mini-electron executable metadata at ${runtimeDist}/version.json`,
    );
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(runtimeDist, executable)))
    hash.update(chunk);
  if (hash.digest("hex") !== expectedHash) {
    throw new Error(`mini-electron executable SHA256 mismatch at ${runtimeDist}/${executable}`);
  }
  return target;
}

function configurePrivateDistribution(normalized, config, projectDir, target) {
  if (target !== "win32-x64") throw new Error("Bundled private plugins require Windows x64.");
  if (normalized.publish && normalized.publish !== "never") {
    throw new Error("The private plugin distribution cannot publish to the public update channel.");
  }
  const resources = config.win?.extraResources ?? [];
  if (
    process.env.OMP_DESKTOP_BUNDLE_OMP === "0" ||
    !Array.isArray(resources) ||
    !resources.some((item) => item.to === "bin/omp.exe")
  ) {
    throw new Error("The private plugin distribution requires its qualified bundled OMP host.");
  }
  for (const file of ["bundled-omp-plugins/manifest.json", "bundled-omp-manager.json"]) {
    if (!existsSync(path.join(projectDir, file))) {
      throw new Error(
        `Private plugin payload is missing: ${file}. Run stage:bundled-plugins first.`,
      );
    }
  }
  config.extraMetadata = {
    ...config.extraMetadata,
    ompDesktopDistribution: "private-three-plugins",
  };
  config.directories.output = "release-plugins";
  config.win.artifactName = "OMP-Desktop-Plugins-Setup-${version}-${arch}.${ext}";
  config.win.extraResources = [
    ...resources,
    { from: "bundled-omp-plugins", to: "bundled-omp-plugins" },
    { from: "bundled-omp-manager.json", to: "manager.json" },
  ];
  normalized.publish = "never";
}

export async function resolveBuildOptions(runtimeDist, runtime, args, projectDir = desktopRoot) {
  const withPlugins = args.includes("--with-bundled-plugins");
  const options = configureBuildCommand(createYargs()).parseSync(
    args.filter((arg) => arg !== "--with-bundled-plugins"),
  );
  if (!["x64", "arm64"].includes(runtime.arch) || !runtime.electronApiVersion) {
    throw new Error(`Invalid mini-electron runtime metadata at ${runtimeDist}/version.json`);
  }

  // Match the installed runtime even when Node is running under Rosetta.
  if (!["x64", "arm64", "ia32", "armv7l", "universal"].some((arch) => options[arch])) {
    options[runtime.arch] = true;
  }
  const normalized = normalizeOptions(options);
  if (normalized.prepackaged != null) {
    throw new Error(
      "--prepackaged bypasses qualified runtime/resource staging and distribution metadata. " +
        "Package from source instead (use --dir to create an unpacked application).",
    );
  }
  const target = await qualifyRuntime(runtimeDist, runtime, normalized);

  projectDir = path.resolve(normalized.projectDir ?? projectDir);
  const configFromOptions =
    typeof normalized.config === "object" ? coerceTypes(normalized.config) : undefined;
  const configPath =
    typeof normalized.config === "string" ? normalized.config : "electron-builder.yml";
  const config = await getConfig(projectDir, configPath, configFromOptions);
  config.extends = null;
  config.electronDist = runtimeDist;
  config.electronVersion = runtime.electronApiVersion;
  if (runtime.platform === "win32" && config.win?.signAndEditExecutable === false) {
    throw new Error("Windows packaging requires real executable resource editing and signing.");
  }
  if (withPlugins) configurePrivateDistribution(normalized, config, projectDir, target);
  if (runtime.platform === "win32") deferQualifiedWindowsResources(config, projectDir);
  return { ...normalized, projectDir, config };
}

async function main() {
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
  const options = await resolveBuildOptions(runtimeDist, runtime, process.argv.slice(2));
  console.log(
    `Packaging with mini-electron ${runtime.runtimeVersion} ${runtime.platform}-${runtime.arch}: ${runtimeDist}`,
  );
  await build(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

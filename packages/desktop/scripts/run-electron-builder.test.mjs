import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { resolveBuildOptions } from "./run-electron-builder.mjs";
import { windowsBuildOutput } from "./windows-build-output.mjs";

const require = createRequire(import.meta.url);
const { WinPackager } = require("app-builder-lib/out/winPackager");
const { copyFiles, getFileMatchers } = require("app-builder-lib/out/fileMatcher");
const { Arch } = require("builder-util");
const { Platform } = require("app-builder-lib/out/core");

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

function createPackagingFixture(platform = "win32") {
  const directory = mkdtempSync(path.join(os.tmpdir(), "omp-build-options-"));
  const executable = platform === "win32" ? "electron.exe" : "Electron.app/Contents/MacOS/Electron";
  const runtimeDist = path.join(directory, "runtime");
  mkdirSync(path.dirname(path.join(runtimeDist, executable)), { recursive: true });
  const executableBytes = Buffer.from("mini-electron packaging unit fixture");
  writeFileSync(path.join(runtimeDist, executable), executableBytes);
  const runtime = {
    platform,
    arch: platform === "win32" ? "x64" : "arm64",
    runtimeVersion: platform === "win32" ? "0.1.15" : "0.1.16",
    electronApiVersion: "41.2.0",
    installerProtocol: 1,
    files: { [executable]: createHash("sha256").update(executableBytes).digest("hex") },
  };
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "packaging-fixture" }),
  );
  writeFileSync(
    path.join(directory, "electron-builder.yml"),
    [
      "directories:",
      "  output: release",
      "win:",
      '  artifactName: "OMP-Desktop-Setup-${version}-${arch}.${ext}"',
      "  signAndEditExecutable: true",
      "  extraResources:",
      "    - from: host/omp.exe",
      "      to: bin/omp.exe",
      "    - from: assets/icon.png",
      "      to: icon.png",
    ].join("\n"),
  );
  mkdirSync(path.join(directory, "host"));
  writeFileSync(path.join(directory, "host/omp.exe"), "qualified OMP host bytes");
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "assets/icon.png"), "icon fixture");
  return {
    directory,
    runtimeDist,
    runtime,
    args: platform === "win32" ? ["--win", "--x64"] : ["--mac", "--arm64"],
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

describe("public and private packaging boundaries", () => {
  test("standard public builds require no vendor payload and retain executable editing", async () => {
    const fixture = createPackagingFixture();
    try {
      const result = await resolveBuildOptions(
        fixture.runtimeDist,
        fixture.runtime,
        fixture.args,
        fixture.directory,
      );
      expect(result.config.directories.output).toBe("release");
      expect(result.config.win.artifactName).toBe("OMP-Desktop-Setup-${version}-${arch}.${ext}");
      expect(result.config.win.signAndEditExecutable).toBe(true);
      expect(result.config.extraMetadata?.ompDesktopDistribution).toBeUndefined();
      expect(result.config.win.extraResources.map((resource) => resource.to)).toEqual(["icon.png"]);
      expect(result.config.electronDist).toBe(fixture.runtimeDist);
      expect(result.config.electronVersion).toBe("41.2.0");
    } finally {
      fixture.dispose();
    }
  });

  test("private builds fail closed when the staged payload is absent", async () => {
    const fixture = createPackagingFixture();
    try {
      await expect(
        resolveBuildOptions(
          fixture.runtimeDist,
          fixture.runtime,
          [...fixture.args, "--with-bundled-plugins"],
          fixture.directory,
        ),
      ).rejects.toThrow("Private plugin payload is missing");
    } finally {
      fixture.dispose();
    }
  });

  test("explicit private builds preserve public resources and mark only the packaged distribution", async () => {
    const fixture = createPackagingFixture();
    try {
      mkdirSync(path.join(fixture.directory, "bundled-omp-plugins"));
      writeFileSync(path.join(fixture.directory, "bundled-omp-plugins/manifest.json"), "{}");
      writeFileSync(
        path.join(fixture.directory, "bundled-omp-manager.json"),
        JSON.stringify({
          manager: "omp-desktop-private-plugins",
          name: "OMP Desktop 三插件定制版",
        }),
      );
      const result = await resolveBuildOptions(
        fixture.runtimeDist,
        fixture.runtime,
        [...fixture.args, "--with-bundled-plugins"],
        fixture.directory,
      );
      expect(result.publish).toBe("never");
      expect(result.config.extraMetadata.ompDesktopDistribution).toBe("private-three-plugins");
      expect(result.config.directories.output).toBe("release-plugins");
      expect(result.config.win.artifactName).toBe(
        "OMP-Desktop-Plugins-Setup-${version}-${arch}.${ext}",
      );
      expect(result.config.win.extraResources.map((resource) => resource.to)).toEqual(["icon.png"]);
    } finally {
      fixture.dispose();
    }
  });

  test.each([
    { args: ["--publish", "always"], message: "cannot publish" },
    { args: ["--config.win.extraResources="], message: "qualified bundled OMP host" },
  ])("private builds reject unsafe configuration $args", async ({ args, message }) => {
    const fixture = createPackagingFixture();
    try {
      await expect(
        resolveBuildOptions(
          fixture.runtimeDist,
          fixture.runtime,
          [...fixture.args, "--with-bundled-plugins", ...args],
          fixture.directory,
        ),
      ).rejects.toThrow(message);
    } finally {
      fixture.dispose();
    }
  });

  test("Windows refuses the macOS runtime version even when the platform field says Windows", async () => {
    const fixture = createPackagingFixture();
    try {
      await expect(
        resolveBuildOptions(
          fixture.runtimeDist,
          { ...fixture.runtime, runtimeVersion: "0.1.16" },
          fixture.args,
          fixture.directory,
        ),
      ).rejects.toThrow("requires mini-electron 0.1.15");
    } finally {
      fixture.dispose();
    }
  });

  test("macOS retains explicit stable local signing options", async () => {
    const fixture = createPackagingFixture("darwin");
    try {
      const result = await resolveBuildOptions(
        fixture.runtimeDist,
        fixture.runtime,
        [
          ...fixture.args,
          "--config.mac.identity=OMP Desktop Local",
          "--config.mac.notarize=false",
          "--config.forceCodeSigning=true",
        ],
        fixture.directory,
      );
      expect(result.config.mac.identity).toBe("OMP Desktop Local");
      expect(result.config.mac.notarize).toBe(false);
      expect(result.config.forceCodeSigning).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  test("Windows rejects disabling PE editing instead of fixing the signing tool cache", async () => {
    const fixture = createPackagingFixture();
    try {
      await expect(
        resolveBuildOptions(
          fixture.runtimeDist,
          fixture.runtime,
          [...fixture.args, "--config.win.signAndEditExecutable=false"],
          fixture.directory,
        ),
      ).rejects.toThrow("requires real executable resource editing");
    } finally {
      fixture.dispose();
    }
  });

  test("a changed runtime executable cannot be packaged as the qualified runtime", async () => {
    const fixture = createPackagingFixture();
    try {
      writeFileSync(path.join(fixture.runtimeDist, "electron.exe"), "changed runtime");
      await expect(
        resolveBuildOptions(fixture.runtimeDist, fixture.runtime, fixture.args, fixture.directory),
      ).rejects.toThrow("mini-electron executable SHA256 mismatch");
    } finally {
      fixture.dispose();
    }
  });
});

function stagePrivateFixture(directory) {
  mkdirSync(path.join(directory, "bundled-omp-plugins/helper"), { recursive: true });
  writeFileSync(path.join(directory, "bundled-omp-plugins/manifest.json"), '{"fixture":true}');
  writeFileSync(
    path.join(directory, "bundled-omp-plugins/helper/helper.exe"),
    "qualified private helper bytes",
  );
  writeFileSync(
    path.join(directory, "bundled-omp-plugins/helper/LICENSE"),
    "private helper license",
  );
  writeFileSync(
    path.join(directory, "bundled-omp-manager.json"),
    '{"manager":"omp-desktop-private-plugins"}',
  );
}

describe("qualified Windows resource bytes", () => {
  test.each([false, true])(
    "preserves sealed resources through real copy/sign passes (private=%s)",
    async (privateMode) => {
      const fixture = createPackagingFixture();
      try {
        if (privateMode) stagePrivateFixture(fixture.directory);
        mkdirSync(path.join(fixture.directory, "third-party"));
        writeFileSync(
          path.join(fixture.directory, "third-party/public-tool.exe"),
          "ordinary extra executable",
        );
        writeFileSync(
          path.join(fixture.directory, "hook.cjs"),
          `
        const fs = require("node:fs");
        const path = require("node:path");
        exports.afterPack = (context) => {
          const resources = path.join(context.appOutDir, "resources");
          if (!fs.existsSync(path.join(resources, "bin/omp.exe"))) throw new Error("host not staged before original hook");
          fs.writeFileSync(path.join(resources, "original-hook-ran"), "yes");
        };
      `,
        );
        // Exercise an alternative config and its named hook export, not just the
        // repository's default afterPack hook.
        const alternativeConfig = {
          directories: { output: "release" },
          files: ["**/*"],
          afterPack: "./hook.cjs",
          win: {
            signAndEditExecutable: true,
            extraResources: [
              { from: "host/omp.exe", to: "bin/omp.exe" },
              { from: "third-party", to: "third-party" },
            ],
          },
        };
        writeFileSync(
          path.join(fixture.directory, "alternative.json"),
          JSON.stringify(alternativeConfig),
        );
        const result = await resolveBuildOptions(
          fixture.runtimeDist,
          fixture.runtime,
          [
            ...fixture.args,
            "--config",
            "alternative.json",
            ...(privateMode ? ["--with-bundled-plugins"] : []),
          ],
          fixture.directory,
        );
        const appOutDir = path.join(fixture.directory, "out/win-unpacked");
        mkdirSync(appOutDir, { recursive: true });
        writeFileSync(path.join(appOutDir, "OMP Desktop.exe"), "Desktop PE fixture");
        writeFileSync(path.join(appOutDir, "public-root.exe"), "ordinary root executable");
        // Use the installed WinPackager methods with an owned, credential-free
        // signing boundary. No build, PE tool download, or certificate is needed.
        const packager = Object.create(WinPackager.prototype);
        packager.info = {
          config: result.config,
          projectDir: fixture.directory,
          framework: { name: "electron" },
        };
        packager.platform = Platform.WINDOWS;
        packager.platformSpecificBuildOptions = result.config.win;
        packager.appInfo = { productFilename: "OMP Desktop", version: "1.0.0" };
        const signed = [];
        const edited = [];
        packager.signIf = async (file) => {
          signed.push(path.relative(appOutDir, file).replaceAll("\\", "/"));
          writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from(" signed")]));
          return true;
        };
        packager.signAndEditResources = async (file) => {
          edited.push(path.basename(file));
          await packager.signIf(file);
        };
        const context = {
          packager,
          appOutDir,
          outDir: path.join(fixture.directory, "out"),
          arch: Arch.x64,
          electronPlatformName: "win32",
        };
        const options = packager.createGetFileMatchersOptions(
          context.outDir,
          context.arch,
          result.config.win,
        );
        const matchers = packager.getExtraFileMatchers(true, appOutDir, options);
        await copyFiles(matchers, packager.createTransformerForExtraFiles(context), false);
        await result.config.afterPack(context);
        await packager.signApp(context, false);
        expect(readFileSync(path.join(appOutDir, "resources/bin/omp.exe"))).toEqual(
          readFileSync(path.join(fixture.directory, "host/omp.exe")),
        );
        expect(readFileSync(path.join(appOutDir, "resources/original-hook-ran"), "utf8")).toBe(
          "yes",
        );
        expect(edited).toEqual(["OMP Desktop.exe"]);
        expect(signed.sort()).toEqual(
          ["OMP Desktop.exe", "public-root.exe", "resources/third-party/public-tool.exe"].sort(),
        );
        const appMatchers = getFileMatchers(
          result.config,
          "files",
          path.join(appOutDir, "resources/app"),
          options,
        );
        const appFilter = appMatchers[0].createFilter();
        const hostSource = path.join(fixture.directory, "host/omp.exe");
        expect(appFilter(hostSource, statSync(hostSource))).toBe(false);
        if (privateMode) {
          for (const file of ["manifest.json", "helper/helper.exe", "helper/LICENSE"]) {
            expect(
              readFileSync(path.join(appOutDir, "resources/bundled-omp-plugins", file)),
            ).toEqual(readFileSync(path.join(fixture.directory, "bundled-omp-plugins", file)));
          }
          expect(readFileSync(path.join(appOutDir, "resources/manager.json"))).toEqual(
            readFileSync(path.join(fixture.directory, "bundled-omp-manager.json")),
          );
          const helperSource = path.join(
            fixture.directory,
            "bundled-omp-plugins/helper/helper.exe",
          );
          expect(appFilter(helperSource, statSync(helperSource))).toBe(false);
        }
      } finally {
        fixture.dispose();
      }
    },
  );
});

describe("prepackaged distribution boundary", () => {
  test.each([
    { privateMode: true, actualPrivate: false, publish: "never" },
    { privateMode: false, actualPrivate: true, publish: "always" },
    { privateMode: false, actualPrivate: false, publish: "never" },
  ])(
    "rejects bypassed resource/metadata staging: $privateMode / $actualPrivate",
    async ({ privateMode, actualPrivate, publish }) => {
      const fixture = createPackagingFixture();
      try {
        const unpacked = path.join(fixture.directory, "owned-unpacked");
        mkdirSync(path.join(unpacked, "resources/app"), { recursive: true });
        writeFileSync(
          path.join(unpacked, "resources/app/package.json"),
          JSON.stringify({
            name: "actual-packaged-metadata",
            ...(actualPrivate ? { ompDesktopDistribution: "private-three-plugins" } : {}),
          }),
        );
        await expect(
          resolveBuildOptions(
            fixture.runtimeDist,
            fixture.runtime,
            [
              ...fixture.args,
              "--prepackaged",
              unpacked,
              "--publish",
              publish,
              ...(privateMode ? ["--with-bundled-plugins"] : []),
            ],
            fixture.directory,
          ),
        ).rejects.toThrow("--prepackaged bypasses qualified runtime/resource staging");
      } finally {
        fixture.dispose();
      }
    },
  );

  test("public --dir still builds an unpacked application through normal staging", async () => {
    const fixture = createPackagingFixture();
    try {
      const result = await resolveBuildOptions(
        fixture.runtimeDist,
        fixture.runtime,
        [...fixture.args, "--dir"],
        fixture.directory,
      );
      expect(result.prepackaged).toBeUndefined();
      expect(result.config.directories.output).toBe("release");
      expect(typeof result.config.afterPack).toBe("function");
    } finally {
      fixture.dispose();
    }
  });
});

describe("Windows wrapper metadata boundary", () => {
  test.each(["1.2.3", "1.2.3-beta.4"])(
    "private output selection only merges private metadata (%s)",
    async (version) => {
      const fixture = createPackagingFixture();
      try {
        stagePrivateFixture(fixture.directory);
        const args = [...fixture.args, "--with-bundled-plugins"];
        const result = await resolveBuildOptions(
          fixture.runtimeDist,
          fixture.runtime,
          args,
          fixture.directory,
        );
        const output = windowsBuildOutput(version, args);
        const selection = spawnSync(
          process.execPath,
          [fileURLToPath(new URL("./windows-build-output.mjs", import.meta.url)), version, ...args],
          { encoding: "utf8" },
        );
        expect(selection.error).toBeUndefined();
        expect(selection.status).toBe(0);
        expect(selection.stdout.trim().split("\t")).toEqual([
          output.releaseDirectory,
          output.metadataFilename,
          output.legacyInstaller,
        ]);
        const publicOutput = windowsBuildOutput(version, fixture.args);
        expect(path.basename(output.releaseDirectory)).toBe(result.config.directories.output);
        expect(output.legacyInstaller).toBe(`OMP-Desktop-Plugins-Setup-${version}.exe`);
        expect(output.metadataFilename).toBe(version.includes("-") ? "beta.yml" : "latest.yml");
        const privateDirectory = path.join(fixture.directory, output.releaseDirectory);
        const publicDirectory = path.join(fixture.directory, publicOutput.releaseDirectory);
        mkdirSync(privateDirectory, { recursive: true });
        mkdirSync(publicDirectory, { recursive: true });
        const publicMetadata = path.join(publicDirectory, publicOutput.metadataFilename);
        const publicContents = "unrelated public metadata must remain byte-identical\n";
        writeFileSync(publicMetadata, publicContents);
        writeFileSync(path.join(publicDirectory, publicOutput.legacyInstaller), "public installer");
        const privateUrl = `OMP-Desktop-Plugins-Setup-${version}-x64.exe`;
        const snapshot = path.join(fixture.directory, "snapshot.yml");
        writeFileSync(
          snapshot,
          `version: ${version}\nfiles:\n  - url: ${privateUrl}\n    sha512: private-checksum\npath: ${privateUrl}\nsha512: private-checksum\n`,
        );
        const destination = path.join(privateDirectory, output.metadataFilename);
        const mergeScript = fileURLToPath(
          new URL("../../../scripts/merge-windows-update-metadata.mjs", import.meta.url),
        );
        const merged = spawnSync(process.execPath, [mergeScript, destination, snapshot], {
          encoding: "utf8",
        });
        expect(merged.error).toBeUndefined();
        expect(merged.status).toBe(0);
        expect(readFileSync(destination, "utf8")).toContain(privateUrl);
        expect(readFileSync(publicMetadata, "utf8")).toBe(publicContents);
        expect(readFileSync(path.join(publicDirectory, publicOutput.legacyInstaller), "utf8")).toBe(
          "public installer",
        );
      } finally {
        fixture.dispose();
      }
    },
  );
});

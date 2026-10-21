import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInterface } from "node:readline";
import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  SessionInboundMessageSchema,
  type SessionOutboundMessage,
} from "@omp-desktop/protocol/messages";
import { createTestLogger } from "../test-utils/test-logger.js";
import { OmpPluginCliService } from "./omp-plugin-cli-service.js";
import { OmpPluginSession } from "./omp-plugin-session.js";

import { execCommand, spawnProcess } from "../utils/spawn.js";
import {
  provisionBundledOmpPlugins as provisionNative,
  resolveOmpPluginInvocation,
  validateBundledOmpPayload,
} from "./bundled-omp-plugins.js";
import { resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig } from "./persisted-config.js";
import { buildOmpLaunch } from "./agent/providers/omp/runtime.js";
import { assertBundledOmpHost, BUNDLED_OMP_HOST } from "./bundled-omp-host.js";
import {
  applyPendingOmpUpdate,
  installOmp,
  replaceManagedOmpBinary,
  resolveOmpUpdatePaths,
} from "./agent/providers/omp/installer.js";

const NAMES = ["omp-bridge-chatpro", "omp-workbuddy-plugin", "omp-wechat-connector"];
const roots: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

// Every opted-in child stays inside the fixture, even when no cwd is supplied.
function provisionBundledOmpPlugins(options: Parameters<typeof provisionNative>[0] = {}) {
  return provisionNative({ cwd: options.env?.USERPROFILE, ...options });
}

async function temporaryDirectory() {
  const root = await mkdtemp(join(tmpdir(), "omp-bundled-plugins-"));
  roots.push(root);
  return root;
}

async function fixture() {
  const root = await temporaryDirectory();
  const home = join(root, "home");
  const payload = join(root, "payload");
  await mkdir(home);
  await mkdir(payload);
  const plugins = [];
  for (const name of NAMES) {
    const directory = join(payload, name);
    await mkdir(join(directory, "assets"), { recursive: true });
    // These are inert native packages, not executable extension mocks. All
    // lifecycle tests below run the real custom host's plugin manager.
    const pkg = JSON.stringify({
      name,
      version: "0.1.0",
      omp: { settings: { label: { type: "string", description: "Fixture label" } } },
    });
    const asset = `package-owned data for ${name}\n`;
    await writeFile(join(directory, "package.json"), pkg);
    await writeFile(join(directory, "assets", "identity.txt"), asset);
    plugins.push({
      name,
      version: "0.1.0",
      directory: name,
      files: [
        { path: "package.json", sha256: sha(pkg), bytes: Buffer.byteLength(pkg) },
        { path: "assets/identity.txt", sha256: sha(asset), bytes: Buffer.byteLength(asset) },
      ],
    });
  }
  const manifest = { schemaVersion: 1, host: BUNDLED_OMP_HOST, plugins };
  const manifestPath = join(payload, "manifest.json");
  const saveManifest = async () => writeFile(manifestPath, JSON.stringify(manifest));
  await saveManifest();
  const env: NodeJS.ProcessEnv = {};
  // No API keys, accounts, real app-data paths, BUN_OPTIONS or user config are
  // inherited. PATH is only for the native executable's ordinary OS helpers.
  for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    USERPROFILE: home,
    HOME: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    PI_CONFIG_DIR: ".omp",
    PI_CODING_AGENT_DIR: join(home, ".omp", "agent"),
    OMP_PROFILE: "default",
    PI_PROFILE: "default",
    OMP_DESKTOP_BUNDLED_PLUGINS: payload,
    OMP_COMMAND: process.env.OMP_BUNDLED_TEST_COMMAND,
  });
  const profileRoot = join(home, ".omp");
  const namespace = join(profileRoot, "desktop-bundled-plugins");
  const ledgerPath = join(namespace, "ledger.json");
  const ledger = async () =>
    JSON.parse(await readFile(ledgerPath, "utf8")) as {
      plugins: Record<string, { state: string; packageSha256: string; error?: string }>;
    };
  const cli = async (...args: string[]) =>
    (
      await execCommand(env.OMP_COMMAND!, ["plugin", ...args], {
        envMode: "internal",
        env,
        cwd: home,
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout;
  const list = async () =>
    JSON.parse(await cli("list", "--json")) as {
      npm: Array<{ name: string; version: string; path: string; enabled: boolean }>;
    };
  return {
    root,
    home,
    payload,
    manifest,
    saveManifest,
    env,
    profileRoot,
    namespace,
    ledgerPath,
    ledger,
    cli,
    list,
  };
}

async function localPackage(root: string, name: string, version: string) {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name,
      version,
      omp: { settings: { label: { type: "string", description: "User setting" } } },
    }),
  );
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bundled plugin inventory integrity", () => {
  it("rejects same-size payload tampering after verification even when mtime is restored", async () => {
    const f = await fixture();
    const file = join(f.payload, NAMES[0]!, "assets", "identity.txt");
    const original = await readFile(file, "utf8");
    const mtime = new Date("2020-01-01T00:00:00.000Z");
    await utimes(file, mtime, mtime);
    await expect(validateBundledOmpPayload(f.payload)).resolves.toMatchObject({
      manifestSha256: sha(JSON.stringify(f.manifest)),
    });
    const corrupt = "!".repeat(Buffer.byteLength(original));
    await writeFile(file, corrupt);
    await utimes(file, mtime, mtime);
    await expect(validateBundledOmpPayload(f.payload)).rejects.toThrow("integrity");
    expect(await readFile(file, "utf8")).toBe(corrupt);
    expect(await readdir(f.home)).toEqual([]);
  });

  it.each([
    "../outside",
    "/absolute",
    "C:/outside",
    "assets\\outside",
    "assets/x:ads",
    "assets/NUL.txt",
    "assets/trailing.",
    "assets//empty",
  ])("rejects unsafe manifest path %s", async (path) => {
    const f = await fixture();
    f.manifest.plugins[0]!.files.push({ path, sha256: sha(""), bytes: 0 });
    await f.saveManifest();
    await expect(validateBundledOmpPayload(f.payload)).rejects.toThrow("Unsafe");
    expect(await readdir(f.home)).toEqual([]);
  });

  it("rejects unmanifested files, duplicate case-folded names and incomplete manifests", async () => {
    const f = await fixture();
    await validateBundledOmpPayload(f.payload);
    const extra = join(f.payload, NAMES[0]!, "extra.txt");
    await writeFile(extra, "unexpected");
    await expect(validateBundledOmpPayload(f.payload)).rejects.toThrow("Unmanifested");
    await rm(extra);
    f.manifest.plugins[0]!.files.push({
      ...f.manifest.plugins[0]!.files[0]!,
      path: "PACKAGE.JSON",
    });
    await f.saveManifest();
    await expect(validateBundledOmpPayload(f.payload)).rejects.toThrow("Duplicate");
    f.manifest.plugins.pop();
    await f.saveManifest();
    await expect(validateBundledOmpPayload(f.payload)).rejects.toThrow();
  });

  it("rejects junction/symlink directories without following or deleting their target", async () => {
    const f = await fixture();
    await validateBundledOmpPayload(f.payload);
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "identity.txt"), "must survive");
    const assets = join(f.payload, NAMES[0]!, "assets");
    await rm(assets, { recursive: true });
    await symlink(outside, assets, process.platform === "win32" ? "junction" : "dir");
    await expect(validateBundledOmpPayload(f.payload)).rejects.toThrow("Symlink");
    expect(await readFile(join(outside, "identity.txt"), "utf8")).toBe("must survive");
  });

  it("requires the exact bound host manifest rather than a stock same-version host", async () => {
    const f = await fixture();
    const value = JSON.parse(JSON.stringify(f.manifest));
    value.host.sha256 = "0".repeat(64);
    await writeFile(join(f.payload, "manifest.json"), JSON.stringify(value));
    await expect(validateBundledOmpPayload(f.payload)).rejects.toThrow();
    expect(await readdir(f.home)).toEqual([]);
  });

  it("rejects generic installer mutation before moving existing binary or staged bytes", async () => {
    const f = await fixture();
    const current = join(f.root, "omp.exe");
    const staged = join(f.root, "staged.exe");
    const previous = join(f.root, "previous.exe");
    await writeFile(current, "bound current");
    await writeFile(staged, "stock replacement");
    vi.stubEnv("OMP_DESKTOP_BUNDLED_PLUGINS", f.payload);
    await expect(installOmp()).rejects.toThrow("plugin-bound");
    await expect(
      replaceManagedOmpBinary({
        installPath: current,
        stagedPath: staged,
        previousPath: previous,
        validate: async () => {},
      }),
    ).rejects.toThrow("plugin-bound");
    const update = resolveOmpUpdatePaths(current);
    await copyFile(staged, update.stagedPath);
    await writeFile(update.checksumPath, sha("stock replacement"));
    await expect(
      applyPendingOmpUpdate({ env: { ...f.env, OMP_COMMAND: current } }),
    ).resolves.toMatchObject({
      applied: false,
      pending: true,
      message: expect.stringContaining("plugin-bound"),
    });
    expect(await readFile(update.stagedPath, "utf8")).toBe("stock replacement");
    expect(await readFile(current, "utf8")).toBe("bound current");
    expect(await readFile(staged, "utf8")).toBe("stock replacement");
    await expect(lstat(previous)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("effective OMP plugin invocation", () => {
  it("shares persisted provider command/env resolution with the provider runtime", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "config.json"),
      JSON.stringify({
        agents: {
          providers: {
            omp: {
              command: [f.env.OMP_COMMAND || "omp", "--profile", "cli-selected"],
              env: { OMP_PROFILE: "persisted" },
            },
          },
        },
      }),
    );
    const config = resolveConfigFromPersisted(f.home, loadPersistedConfig(f.home), { env: f.env });
    const invocation = await resolveOmpPluginInvocation({
      provider: config.providerOverrides?.omp,
      runtimeSettings: config.agentProviderSettings?.omp,
      env: f.env,
      cwd: f.home,
    });
    const launch = buildOmpLaunch({
      command: [f.env.OMP_COMMAND || "omp"],
      runtimeSettings: config.agentProviderSettings?.omp,
      session: { cwd: f.home },
    });
    expect(invocation.command).toEqual(launch.argv.slice(0, 3));
    expect(invocation.env.OMP_PROFILE).toBe(launch.env?.OMP_PROFILE);
    expect(invocation.cwd).toBe(launch.cwd);
    expect(invocation.env.OMP_DESKTOP_BUNDLED_PLUGINS).toBe(f.payload);
  });

  it("preserves appended profile args and provider/session env precedence without interpreting dotenv", async () => {
    const f = await fixture();
    await writeFile(join(f.home, ".env"), "OMP_PROFILE=not-read-by-desktop\n");
    const invocation = await resolveOmpPluginInvocation({
      env: { ...f.env, OMP_PROFILE: "base" },
      runtimeSettings: {
        command: { mode: "append", args: ["--profile=work"] },
        env: { OMP_PROFILE: "runtime" },
      },
      provider: { env: { OMP_PROFILE: "provider" } },
      cwd: f.home,
    });
    expect(invocation.command).toEqual([f.env.OMP_COMMAND || "omp", "--profile=work"]);
    expect(invocation.env.OMP_PROFILE).toBe("provider");
  });
});

// Set only this explicit, checksum-pinned command to run the real native CLI
// lifecycle suite. It never discovers or touches the user's installed runtime.
const hasRealHost =
  process.platform === "win32" &&
  process.arch === "x64" &&
  Boolean(process.env.OMP_BUNDLED_TEST_COMMAND);
describe.skipIf(!hasRealHost)("real native bundled plugin provisioning", () => {
  it("initializes a private profile on first Desktop plugin management without startup pre-seeding", async () => {
    const f = await fixture();
    for (const [name, value] of Object.entries(f.env)) {
      if (value !== undefined) vi.stubEnv(name, value);
    }
    const service = new OmpPluginCliService({
      logger: createTestLogger(),
      resolveOmpCommand: async () => f.env.OMP_COMMAND!,
    });
    const initial = await service.list(f.home);
    expect(initial.rawOutput).toBeUndefined();
    expect(initial.plugins.map((plugin) => plugin.name).sort()).toEqual([...NAMES].sort());
    for (const entry of Object.values((await f.ledger()).plugins)) {
      expect(entry.state).toBe("completed");
    }
    await f.cli("uninstall", NAMES[0]!, "--json");
    const afterUninstall = await service.list(f.home);
    expect(afterUninstall.plugins.some((plugin) => plugin.name === NAMES[0])).toBe(false);
    expect((await f.ledger()).plugins[NAMES[0]!].state).toBe("uninstalled");
  }, 180_000);

  it("leaves interrupted ownership initialization unpublished so the next seed can succeed", async () => {
    const f = await fixture();
    const realOpen = fs.open;
    const open = vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
      if (basename(String(file)) === "owner") {
        throw Object.assign(new Error("Interrupted ownership initialization"), { code: "EIO" });
      }
      return realOpen(file, flags, mode);
    });
    syncBuiltinESMExports();
    try {
      await expect(provisionBundledOmpPlugins({ env: f.env })).rejects.toThrow(
        "Interrupted ownership initialization",
      );
      await expect(lstat(f.namespace)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      open.mockRestore();
      syncBuiltinESMExports();
    }
    const seeded = await provisionBundledOmpPlugins({ env: f.env });
    expect(seeded.plugins.map((entry) => entry.state)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect((await f.list()).npm.map((plugin) => plugin.name).sort()).toEqual([...NAMES].sort());
  }, 180_000);

  it.each([
    { marker: "missing", expectedOwner: "ENOENT" },
    { marker: "invalid", expectedOwner: "foreign owner" },
  ])(
    "preserves a foreign namespace with a $marker ownership marker",
    async ({ marker, expectedOwner }) => {
      const f = await fixture();
      await mkdir(f.namespace, { recursive: true });
      const sentinel = join(f.namespace, "keep.txt");
      await writeFile(sentinel, "foreign profile data");
      if (marker === "invalid") await writeFile(join(f.namespace, "owner"), "foreign owner");
      await expect(provisionBundledOmpPlugins({ env: f.env })).rejects.toThrow();
      expect(await readFile(sentinel, "utf8")).toBe("foreign profile data");
      const owner = await readFile(join(f.namespace, "owner"), "utf8").catch(
        (error: NodeJS.ErrnoException) => error.code,
      );
      expect(owner).toBe(expectedOwner);
      await expect(lstat(f.ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
    180_000,
  );

  it.skipIf(process.platform !== "win32")(
    "does not turn a temporary Windows snapshot sharing conflict into a permanent missing plugin",
    async () => {
      const f = await fixture();
      const realRename = fs.rename;
      let conflictPending = true;
      const rename = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        if (conflictPending && basename(String(source)).startsWith(".stage-")) {
          conflictPending = false;
          throw Object.assign(
            new Error("The snapshot is temporarily open without delete sharing"),
            {
              code: "EPERM",
            },
          );
        }
        return realRename(source, destination);
      });
      syncBuiltinESMExports();
      try {
        const seeded = await provisionBundledOmpPlugins({ env: f.env });
        for (const entry of seeded.plugins)
          expect(entry.state, JSON.stringify(entry)).toBe("completed");
        const installed = await f.list();
        expect(installed.npm.map((entry) => entry.name).sort()).toEqual([...NAMES].sort());
        expect((await readdir(join(f.namespace, "packages"))).sort()).toEqual(
          (
            await Promise.all(
              installed.npm.map(async (entry) => basename(await realpath(entry.path))),
            )
          ).sort(),
        );
      } finally {
        rename.mockRestore();
        syncBuiltinESMExports();
      }
    },
    180_000,
  );

  it("seeds persisted and command-prefix profiles without completing the default profile", async () => {
    const f = await fixture();
    const persisted = await resolveOmpPluginInvocation({
      env: f.env,
      cwd: f.home,
      provider: { env: { OMP_PROFILE: "persisted" } },
    });
    await provisionBundledOmpPlugins(persisted);
    const selected = await resolveOmpPluginInvocation({
      env: f.env,
      cwd: f.home,
      provider: {
        command: [f.env.OMP_COMMAND!, "launch", "--profile", "command-profile"],
        env: { OMP_PROFILE: "persisted" },
      },
    });
    await provisionBundledOmpPlugins(selected);
    await provisionBundledOmpPlugins({
      env: f.env,
      command: [f.env.OMP_COMMAND!, "launch", "--profile", "direct-prefix"],
    });
    for (const profile of ["persisted", "command-profile", "direct-prefix"]) {
      const ledger = JSON.parse(
        await readFile(
          join(f.profileRoot, "profiles", profile, "desktop-bundled-plugins", "ledger.json"),
          "utf8",
        ),
      );
      for (const name of NAMES)
        expect(ledger.plugins[name].state, JSON.stringify(ledger.plugins[name])).toBe("completed");
    }
    await expect(lstat(f.ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 180_000);

  it("uses native cwd .env discovery but not Bun mode/local dotenv autoloading", async () => {
    const f = await fixture();
    const cwd = join(f.root, "workspace");
    await mkdir(cwd);
    await writeFile(join(cwd, ".env"), "PI_CONFIG_DIR=.cwd-native\n");
    await writeFile(join(cwd, ".env.production"), "PI_CONFIG_DIR=.wrong-mode\n");
    await writeFile(join(cwd, ".env.local"), "PI_CONFIG_DIR=.wrong-local\n");
    const env = { ...f.env, PI_CONFIG_DIR: "", NODE_ENV: "production" };
    const run = async (...args: string[]) =>
      (
        await execCommand(env.OMP_COMMAND!, args, {
          envMode: "internal",
          env,
          cwd,
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout;
    const listed = JSON.parse(await run("plugin", "list", "--json"));
    expect(listed.paths.dataRoot).toBe(join(f.home, ".cwd-native"));
    expect(listed.paths.pluginsRoot).toBe(join(f.home, ".cwd-native", "plugins"));
    const seeded = await provisionBundledOmpPlugins({ env, cwd });
    for (const entry of seeded.plugins)
      expect(entry.state, JSON.stringify(entry)).toBe("completed");
    const ledgerPath = join(listed.paths.dataRoot, "desktop-bundled-plugins", "ledger.json");
    expect(Object.keys(JSON.parse(await readFile(ledgerPath, "utf8")).plugins)).toEqual(NAMES);
    expect(JSON.parse(await run("plugin", "list", "--json")).npm).toHaveLength(3);
    await expect(lstat(join(f.home, ".wrong-mode"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(f.home, ".wrong-local"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(f.ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 180_000);

  it("serializes concurrent provider launches without marking their fresh seed uninstalled", async () => {
    const f = await fixture();
    const results = await Promise.all([
      provisionBundledOmpPlugins({ env: f.env }),
      provisionBundledOmpPlugins({ env: f.env }),
    ]);
    for (const result of results) {
      for (const entry of result.plugins)
        expect(entry.state, JSON.stringify(entry)).toBe("completed");
    }
    expect((await f.list()).npm).toHaveLength(3);
    expect(
      Object.values((await f.ledger()).plugins).every((entry) => entry.state === "completed"),
    ).toBe(true);
  }, 180_000);

  it("honors project dotenv and launch-prefix profiles through real marketplace and inferred-scope operations", async () => {
    const f = await fixture();
    // The real service runner is used, but it may inherit no workstation secrets.
    for (const key of Object.keys(process.env)) vi.stubEnv(key, undefined);
    for (const [key, value] of Object.entries({ ...f.env, PI_CONFIG_DIR: "" }))
      vi.stubEnv(key, value);
    const projectA = join(f.root, "project-a");
    const projectB = join(f.root, "project-b");
    for (const [cwd, root] of [
      [projectA, ".cwd-a"],
      [projectB, ".cwd-b"],
    ] as const) {
      await mkdir(join(cwd, ".git"), { recursive: true });
      await writeFile(join(cwd, ".env"), `PI_CONFIG_DIR=${root}\n`);
    }
    const market = join(f.root, "market");
    const plugin = join(market, "plugins", "scope-plugin");
    await mkdir(join(market, ".omp-plugin"), { recursive: true });
    await mkdir(join(plugin, ".omp-plugin"), { recursive: true });
    const catalogFile = join(market, ".omp-plugin", "marketplace.json");
    const saveCatalog = async (version: string) => {
      await writeFile(
        catalogFile,
        JSON.stringify({
          name: "cwd-market",
          owner: { name: "Fixture" },
          plugins: [{ name: "scope-plugin", source: "./plugins/scope-plugin", version }],
        }),
      );
      await writeFile(
        join(plugin, ".omp-plugin", "plugin.json"),
        JSON.stringify({ name: "scope-plugin", version }),
      );
      await writeFile(
        join(plugin, "package.json"),
        JSON.stringify({
          name: "scope-plugin",
          version,
          omp: { settings: { label: { type: "string" } } },
        }),
      );
    };
    await saveCatalog("1.0.0");
    const logger = createTestLogger();
    const service = new OmpPluginCliService({
      logger,
      getProviderConfig: () => ({
        command: [f.env.OMP_COMMAND!, "launch", "--profile", "work"],
        env: { OMP_PROFILE: "not-selected" },
      }),
    });
    const emitted: SessionOutboundMessage[] = [];
    const session = new OmpPluginSession({
      service,
      logger,
      emit: (message) => {
        emitted.push(message);
      },
    });
    const request = async (message: object) => {
      await session.handleInboundMessage(SessionInboundMessageSchema.parse(message));
      const response = emitted.at(-1)!;
      expect(response.type).not.toBe("rpc_error");
      return response.payload;
    };
    expect(
      await request({
        type: "ompPlugins.marketplace.add.request",
        requestId: "add-a",
        source: market,
        cwd: projectA,
      }),
    ).toMatchObject({
      ok: true,
      marketplace: { name: "cwd-market" },
    });
    expect((await service.marketplaceList(projectB)).marketplaces).toEqual([]);
    expect(
      await service.install({ spec: "scope-plugin@cwd-market", scope: "project", cwd: projectA }),
    ).toMatchObject({ ok: true });
    expect(await service.setEnabled("scope-plugin@cwd-market", false, undefined, projectA)).toEqual(
      { ok: true },
    );
    expect((await service.list(projectA)).plugins).toContainEqual(
      expect.objectContaining({ id: "scope-plugin@cwd-market", scope: "project", enabled: false }),
    );
    expect(await service.setEnabled("scope-plugin@cwd-market", true, "project", projectA)).toEqual({
      ok: true,
    });
    expect(
      await service.install({ spec: "scope-plugin@cwd-market", scope: "user", cwd: projectA }),
    ).toMatchObject({ ok: true });
    expect(
      await service.setEnabled("scope-plugin@cwd-market", false, undefined, projectA),
    ).toMatchObject({ ok: false });
    expect(await service.setEnabled("scope-plugin@cwd-market", false, "user", projectA)).toEqual({
      ok: true,
    });
    const listed = await service.list(projectA);
    expect(listed.plugins).toContainEqual(
      expect.objectContaining({ id: "scope-plugin@cwd-market", scope: "user", enabled: false }),
    );
    expect(listed.plugins).toContainEqual(
      expect.objectContaining({ id: "scope-plugin@cwd-market", scope: "project", enabled: true }),
    );
    await saveCatalog("2.0.0");
    expect(
      await request({
        type: "ompPlugins.marketplace.update.request",
        requestId: "update-a",
        name: "cwd-market",
        cwd: projectA,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await request({
        type: "ompPlugins.marketplace.list.request",
        requestId: "list-a",
        cwd: projectA,
      }),
    ).toMatchObject({
      marketplaces: [
        { name: "cwd-market", plugins: [expect.objectContaining({ version: "2.0.0" })] },
      ],
    });
    expect(
      await request({
        type: "ompPlugins.marketplace.add.request",
        requestId: "add-b",
        source: market,
        cwd: projectB,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await request({
        type: "ompPlugins.marketplace.remove.request",
        requestId: "remove-a",
        name: "cwd-market",
        cwd: projectA,
      }),
    ).toMatchObject({ ok: true });
    expect((await service.marketplaceList(projectA)).marketplaces).toEqual([]);
    expect((await service.marketplaceList(projectB)).marketplaces).toHaveLength(1);
    await expect(lstat(join(f.home, ".omp", "marketplaces.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(join(f.home, ".cwd-a", "profiles", "not-selected"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      JSON.parse(
        await readFile(join(f.home, ".cwd-a", "profiles", "work", "marketplaces.json"), "utf8"),
      ).marketplaces,
    ).toEqual([]);
  }, 180_000);

  it("keeps a replacement process lease authoritative after owner death and preserves uninstall tombstones", async () => {
    const f = await fixture();
    await provisionBundledOmpPlugins({ env: f.env });
    const legacyLock = join(f.namespace, "provision.lock");
    const sentinel = JSON.stringify({
      pid: 2147483647,
      hostname: "old-owner",
      nonce: "do-not-reap",
    });
    await writeFile(legacyLock, sentinel);
    const children: ChildProcess[] = [];
    const startLease = () => {
      const child = spawnProcess(f.env.OMP_COMMAND!, ["plugin", "lease", "--json"], {
        envMode: "internal",
        env: f.env,
        cwd: f.home,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      children.push(child);
      const closed = once(child, "close");
      const lines = createInterface({ input: child.stdout! });
      const acquired = once(lines, "line").then(([line]) => JSON.parse(String(line)));
      return { child, closed, acquired };
    };
    try {
      const first = startLease();
      expect(await first.acquired).toMatchObject({
        lease: { version: 1, kind: "desktop-bundled-plugins" },
      });
      const replacement = startLease();
      let replaced = false;
      void replacement.acquired.then(() => (replaced = true));
      // This probes absence of a receipt across real processes and OS locks;
      // fake timers cannot advance the independently running native children.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(replaced).toBe(false);
      first.child.kill();
      await first.closed;
      await replacement.acquired;
      // Normal mutations must remain possible while the separate seed lease is held.
      await f.cli("uninstall", NAMES[0]!, "--json");
      let settled = false;
      const waiting = provisionBundledOmpPlugins({ env: f.env }).finally(() => {
        settled = true;
      });
      // Same real-process exclusion window: no JavaScript clock owns the lock.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false);
      expect((await f.ledger()).plugins[NAMES[0]!]!.state).toBe("completed");
      replacement.child.stdin!.end();
      await replacement.closed;
      expect((await waiting).plugins[0]!.state).toBe("uninstalled");
      await provisionBundledOmpPlugins({ env: f.env });
      expect((await f.list()).npm.some((entry) => entry.name === NAMES[0])).toBe(false);
      expect(await readFile(legacyLock, "utf8")).toBe(sentinel);
    } finally {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const closed = once(child, "close");
          child.stdin!.end();
          child.kill();
          await closed;
        }),
      );
    }
  }, 180_000);

  it("arbitrates conditional links against ordinary same-name and unrelated concurrent writers", async () => {
    const f = await fixture();
    const seed = await localPackage(join(f.root, "seed"), NAMES[0]!, "0.1.0");
    const foreign = await localPackage(join(f.root, "foreign"), NAMES[0]!, "9.0.0");
    const unrelated = await localPackage(
      join(f.root, "unrelated"),
      "user-concurrent-plugin",
      "5.0.0",
    );
    const [conditional] = await Promise.all([
      f.cli("link", seed, "--if-missing", "--json"),
      f.cli("link", foreign, "--json"),
      f.cli("link", unrelated, "--json"),
    ]);
    const outcome = JSON.parse(conditional);
    expect(outcome).toMatchObject({ name: NAMES[0], linked: !outcome.preserved });
    const listed = await f.list();
    expect(await realpath(listed.npm.find((entry) => entry.name === NAMES[0])!.path)).toBe(
      await realpath(foreign),
    );
    expect(listed.npm.find((entry) => entry.name === "user-concurrent-plugin")!.version).toBe(
      "5.0.0",
    );
    await Promise.all([
      f.cli("disable", NAMES[0]!, "--json"),
      f.cli("config", "set", NAMES[0]!, "label", "keep-concurrent"),
    ]);
    const lockPath = join(f.profileRoot, "plugins", "omp-plugins.lock.json");
    const before = await readFile(lockPath, "utf8");
    expect(JSON.parse(before).settings[NAMES[0]!].label).toBe("keep-concurrent");
    expect(JSON.parse(await f.cli("link", seed, "--if-missing", "--json"))).toEqual({
      linked: false,
      preserved: true,
      name: NAMES[0],
    });
    expect(await readFile(lockPath, "utf8")).toBe(before);
    expect((await f.list()).npm.find((entry) => entry.name === NAMES[0])!.enabled).toBe(false);
  }, 180_000);

  it("preserves settings-only reservations through the native no-clobber operation", async () => {
    const f = await fixture();
    const foreign = await localPackage(join(f.root, "foreign"), NAMES[0]!, "7.0.0");
    await f.cli("link", foreign, "--json");
    await f.cli("config", "set", NAMES[0]!, "label", "settings-tombstone");
    const pluginsRoot = join(f.profileRoot, "plugins");
    const lockPath = join(pluginsRoot, "omp-plugins.lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    delete lock.plugins[NAMES[0]!];
    await writeFile(lockPath, JSON.stringify(lock));
    await rm(join(pluginsRoot, "node_modules", NAMES[0]!), { recursive: true, force: true });
    expect(JSON.parse(await f.cli("link", foreign, "--if-missing", "--json"))).toEqual({
      linked: false,
      preserved: true,
      name: NAMES[0],
    });
    expect((await provisionBundledOmpPlugins({ env: f.env })).plugins[0]!.state).toBe("preserved");
    expect(JSON.parse(await readFile(lockPath, "utf8")).settings[NAMES[0]!]).toEqual(
      lock.settings[NAMES[0]!],
    );
  }, 180_000);

  it("seeds owned copies, preserves disabled/configured and unrelated plugins, and never upgrades them", async () => {
    const f = await fixture();
    const foreign = await localPackage(join(f.root, "foreign"), NAMES[0]!, "9.9.9");
    const unrelated = await localPackage(
      join(f.root, "unrelated"),
      "user-unrelated-plugin",
      "3.0.0",
    );
    await f.cli("link", foreign, "--json");
    await f.cli("disable", NAMES[0]!, "--json");
    await f.cli("config", "set", NAMES[0]!, "label", "user-choice");
    await f.cli("link", unrelated, "--json");
    const registryPath = join(f.profileRoot, "plugins", "omp-plugins.lock.json");
    const before = JSON.parse(await readFile(registryPath, "utf8"));
    const result = await provisionBundledOmpPlugins({ env: f.env });
    expect(result.plugins.map((entry) => entry.state)).toEqual([
      "preserved",
      "completed",
      "completed",
    ]);
    const after = JSON.parse(await readFile(registryPath, "utf8"));
    expect(after.plugins[NAMES[0]!]).toEqual(before.plugins[NAMES[0]!]);
    expect(after.settings[NAMES[0]!]).toEqual(before.settings[NAMES[0]!]);
    expect(after.plugins["user-unrelated-plugin"]).toEqual(before.plugins["user-unrelated-plugin"]);
    const initialList = await f.list();
    expect(initialList.npm).toHaveLength(4);
    expect(await realpath(initialList.npm.find((entry) => entry.name === NAMES[0])!.path)).toBe(
      await realpath(foreign),
    );
    const seeded = initialList.npm.find((entry) => entry.name === NAMES[1])!;
    const snapshot = await realpath(seeded.path);
    expect(snapshot.startsWith(await realpath(f.namespace))).toBe(true);
    expect(snapshot.startsWith(f.payload)).toBe(false);
    const sourceFile = join(f.payload, NAMES[1]!, "assets", "identity.txt");
    const snapshotFile = join(snapshot, "assets", "identity.txt");
    const original = await readFile(snapshotFile, "utf8");
    const changed = "new application package data\n";
    await writeFile(sourceFile, changed);
    const pkg = f.manifest.plugins[1]!;
    pkg.files[1] = {
      path: "assets/identity.txt",
      sha256: sha(changed),
      bytes: Buffer.byteLength(changed),
    };
    await f.saveManifest();
    await provisionBundledOmpPlugins({ env: f.env });
    expect(await readFile(snapshotFile, "utf8")).toBe(original);
    expect(
      await realpath((await f.list()).npm.find((entry) => entry.name === NAMES[1])!.path),
    ).toBe(snapshot);
  }, 180_000);

  it("records native uninstall once and permits an explicit native reinstall without reseeding", async () => {
    const f = await fixture();
    await provisionBundledOmpPlugins({ env: f.env });
    const original = await realpath(
      (await f.list()).npm.find((entry) => entry.name === NAMES[0])!.path,
    );
    await f.cli("uninstall", NAMES[0]!, "--json");
    const uninstalled = await provisionBundledOmpPlugins({ env: f.env });
    expect(uninstalled.plugins[0]!.state).toBe("uninstalled");
    expect((await f.list()).npm.some((entry) => entry.name === NAMES[0])).toBe(false);
    await provisionBundledOmpPlugins({ env: f.env });
    expect((await f.list()).npm.some((entry) => entry.name === NAMES[0])).toBe(false);
    await f.cli("link", original, "--json");
    await f.cli("disable", NAMES[0]!, "--json");
    await provisionBundledOmpPlugins({ env: f.env });
    expect((await f.list()).npm.find((entry) => entry.name === NAMES[0])!.enabled).toBe(false);
    expect((await f.ledger()).plugins[NAMES[0]!]!.state).toBe("uninstalled");
  }, 180_000);

  it("keeps interrupted/partial attempts distinct and never resurrects their absent plugin", async () => {
    const f = await fixture();
    await provisionBundledOmpPlugins({ env: f.env });
    await f.cli("uninstall", NAMES[0]!, "--json");
    const ledger = await f.ledger();
    ledger.plugins[NAMES[0]!]!.state = "linking";
    await writeFile(f.ledgerPath, JSON.stringify({ ...ledger, schemaVersion: 1 }));
    const result = await provisionBundledOmpPlugins({ env: f.env });
    expect(result.plugins[0]).toMatchObject({
      state: "failed",
      error: expect.stringContaining("interrupted"),
    });
    expect(result.plugins.slice(1).every((entry) => entry.state === "completed")).toBe(true);
    expect((await f.list()).npm.some((entry) => entry.name === NAMES[0])).toBe(false);
    await provisionBundledOmpPlugins({ env: f.env });
    expect((await f.list()).npm.some((entry) => entry.name === NAMES[0])).toBe(false);
    const manual = await localPackage(join(f.root, "manual"), NAMES[0]!, "4.0.0");
    await f.cli("link", manual, "--json");
    await provisionBundledOmpPlugins({ env: f.env });
    expect((await f.list()).npm.find((entry) => entry.name === NAMES[0])!.version).toBe("4.0.0");
  }, 180_000);

  it("isolates named profile seeds and preserves broken native reservations", async () => {
    const f = await fixture();
    const broken = await localPackage(join(f.root, "broken"), NAMES[0]!, "7.0.0");
    await f.cli("link", broken, "--json");
    await rm(broken, { recursive: true });
    expect((await provisionBundledOmpPlugins({ env: f.env })).plugins[0]!.state).toBe("preserved");
    const workEnv = { ...f.env, OMP_PROFILE: "work", PI_PROFILE: "work" };
    expect(
      (await provisionBundledOmpPlugins({ env: workEnv })).plugins.every(
        (entry) => entry.state === "completed",
      ),
    ).toBe(true);
    const named = join(f.profileRoot, "profiles", "work", "desktop-bundled-plugins", "ledger.json");
    expect(JSON.parse(await readFile(named, "utf8")).plugins[NAMES[0]!].state).toBe("completed");
    expect((await f.ledger()).plugins[NAMES[0]!]!.state).toBe("preserved");
  }, 180_000);

  it("refuses corrupt/missing ledgers and namespace junctions without cleaning foreign files", async () => {
    const f = await fixture();
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "unrelated");
    await mkdir(f.profileRoot, { recursive: true });
    await symlink(outside, f.namespace, "junction");
    await expect(provisionBundledOmpPlugins({ env: f.env })).rejects.toThrow("symlink");
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("unrelated");
    await rm(f.namespace, { recursive: true });
    const seeded = await provisionBundledOmpPlugins({ env: f.env });
    for (const entry of seeded.plugins)
      expect(entry.state, JSON.stringify(entry)).toBe("completed");
    await writeFile(f.ledgerPath, "corrupt");
    await expect(provisionBundledOmpPlugins({ env: f.env })).rejects.toThrow("ledger");
    await rm(f.ledgerPath);
    await expect(provisionBundledOmpPlugins({ env: f.env })).rejects.toThrow("ledger is missing");
    expect((await f.list()).npm).toHaveLength(3);
  }, 180_000);

  it("rehashes a changed host and rejects corrupt payload before writing profile state", async () => {
    const f = await fixture();
    await assertBundledOmpHost(f.env.OMP_COMMAND, f.env);
    const changed = join(f.root, "changed-omp.exe");
    await copyFile(f.env.OMP_COMMAND!, changed);
    await assertBundledOmpHost(changed, f.env);
    await chmod(changed, 0o600);
    await writeFile(changed, "not the bound host");
    await expect(assertBundledOmpHost(changed, f.env)).rejects.toThrow("SHA-256 mismatch");
    await expect(
      provisionBundledOmpPlugins({ env: { ...f.env, OMP_COMMAND: changed } }),
    ).rejects.toThrow("SHA-256 mismatch");
    await expect(
      provisionBundledOmpPlugins({
        env: { ...f.env, OMP_DESKTOP_BUNDLED_PLUGINS: join(f.root, "missing-payload") },
      }),
    ).rejects.toThrow();
    await writeFile(join(f.payload, NAMES[0]!, "assets", "identity.txt"), "corrupt");
    await expect(provisionBundledOmpPlugins({ env: f.env })).rejects.toThrow("integrity");
    expect(await readdir(f.home)).toEqual([]);
  }, 180_000);
});

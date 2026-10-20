import { existsSync, readFileSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { OmpStatsRange, OmpStatsResult } from "@omp-desktop/protocol/omp-stats";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";

const moduleRequire = createRequire(import.meta.url);
const PROFILE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RESERVED_PROFILE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;
const SCOPE_ENV_KEYS: Record<string, true | undefined> = {
  PI_CONFIG_DIR: true,
  OMP_CONFIG_DIR: true,
  PI_CODING_AGENT_DIR: true,
  OMP_CODING_AGENT_DIR: true,
  XDG_DATA_HOME: true,
  OMP_PROFILE: true,
  PI_PROFILE: true,
  HOME: true,
  USERPROFILE: true,
  NODE_ENV: true,
};
// The Stats RPC uses the client's 60-second default. Leave time to return a
// sanitized failure instead of leaving an abandoned SQL scan behind it.
const STATS_WORKER_TIMEOUT_MS = 15_000;

interface StatsSource {
  path: string;
  profile: string;
}

interface StatsScopeContext {
  env: Record<string, string>;
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  profile: string | undefined;
}

interface StatsDirectories {
  configRoot: string;
  agentDir: string;
}

function normalizeProfile(value: string | undefined): string | undefined {
  const profile = value?.trim();
  if (!profile || profile === "default") return undefined;
  if (
    profile === "." ||
    profile === ".." ||
    profile.endsWith(".") ||
    !PROFILE_PATTERN.test(profile) ||
    RESERVED_PROFILE_PATTERN.test(profile)
  ) {
    throw new Error("Invalid OMP statistics profile");
  }
  return profile;
}

function assertUnambiguousDotenvCasing(input: NodeJS.ProcessEnv): void {
  const seen: Record<string, true | undefined> = {};
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) continue;
    const canonical = key.toUpperCase();
    // Bun collapses variants before alias expansion; Node loses their source order.
    // Even equal values can produce different alias winners, so never guess.
    if (seen[canonical] === true) {
      throw new Error("Ambiguous OMP statistics dotenv environment casing");
    }
    seen[canonical] = true;
  }
}

function normalizeScopeEnv(
  input: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  source: "launch" | "bootstrap" | "dotenv",
): Record<string, string> {
  if (source !== "launch" && platform === "win32") assertUnambiguousDotenvCasing(input);
  const values = source === "dotenv" ? { ...input } : input;
  if (source === "dotenv") {
    // Native parseEnvFile mirrors only the literal uppercase OMP_ prefix,
    // before its insertion-ordered assignments reach case-insensitive Bun.env.
    for (const key of Object.keys(input)) {
      if (key.startsWith("OMP_")) values[`PI_${key.slice(4)}`] = input[key];
    }
  }
  const keys = Object.keys(values);
  if (source === "launch" && platform === "win32") {
    // Node spawn sorts keys and forwards the first case-insensitive match.
    // Apply this after the launch env's ordinary base/overlay object merge.
    keys.sort();
  }
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = values[key];
    if (value === undefined || value.includes("\0")) continue;
    const canonical = platform === "win32" ? key.toUpperCase() : key;
    if (SCOPE_ENV_KEYS[canonical] !== true) continue;
    // Native dotenv merging assigns when the current case-insensitive value
    // is empty too; launch envs still retain Node spawn's first key, even empty.
    if (env[canonical] !== undefined && (source !== "dotenv" || env[canonical])) continue;
    env[canonical] = value;
  }
  return env;
}

function readScopeEnvFile(path: string, platform: NodeJS.Platform): Record<string, string> {
  // Keep original spellings/order until the appropriate native merge phase.
  // Only scope keys survive: credentials from these files are never returned or logged.
  try {
    const { parseEnv } = moduleRequire("node:util") as {
      parseEnv(content: string): Record<string, string>;
    };
    const parsed = parseEnv(readFileSync(path, "utf8"));
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          SCOPE_ENV_KEYS[platform === "win32" ? key.toUpperCase() : key] === true &&
          !value.includes("\0"),
      ),
    );
  } catch {
    // Native parseEnvFile also ignores missing, unreadable or malformed dotenv files.
    return {};
  }
}

function resolveStatsProfile(
  env: Record<string, string>,
  command: ProviderRuntimeSettings["command"],
): string | undefined {
  let args: readonly string[] = [];
  if (command?.mode === "replace") {
    if (!/^omp(?:\.exe|\.cmd|\.bat)?$/i.test(basename(command.argv[0]!))) {
      throw new Error("Unknown OMP statistics command scope");
    }
    args = command.argv.slice(1);
  } else if (command?.mode === "append") {
    args = command.args ?? [];
  }
  if (args.some((arg) => /^(?:--alias|--cwd)(?:=|$)/.test(arg))) {
    throw new Error("Unknown OMP statistics launch scope");
  }
  let profileValue = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
  if (args.some((arg) => /^--profile(?:=|$)/.test(arg))) {
    // Only profile-only overlays are unambiguous without OMP's full parser.
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      const next = args[index + 1];
      if (arg === "--profile" && next && !next.startsWith("-")) {
        profileValue = args[++index];
      } else if (arg.startsWith("--profile=") && arg.length > "--profile=".length) {
        profileValue = arg.slice("--profile=".length);
      } else {
        throw new Error("Ambiguous OMP statistics profile scope");
      }
    }
  }
  // Only the final explicit flag (or the fallback actually used) is validated.
  return normalizeProfile(profileValue);
}

function mergeNativeScopeEnv(
  base: Record<string, string>,
  sources: readonly Record<string, string>[],
): Record<string, string> {
  const env = { ...base };
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (env[key]) continue;
      if (key === "HOME" || key === "USERPROFILE") {
        throw new Error("Unknown OMP statistics dotenv home scope");
      }
      env[key] = value;
    }
  }
  return env;
}

function readStatsStartupScope(
  env: Record<string, string>,
  cwd: string,
  platform: NodeJS.Platform,
): { startupFile: Record<string, string>; env: Record<string, string> } {
  const startupFile = readScopeEnvFile(join(cwd, ".env"), platform);
  const startupEnv = normalizeScopeEnv(startupFile, platform, "bootstrap");
  const mode = env.NODE_ENV || "development";
  const bootstrapEnvs = [`.env.${mode}`, ".env.local", `.env.${mode}.local`].map((file) =>
    normalizeScopeEnv(readScopeEnvFile(join(cwd, file), platform), platform, "bootstrap"),
  );
  // Bun preloads cwd dotenv before freezing profile/home. Reject unsupported
  // expansion, mode-file or profile changes rather than choose another index.
  if (
    bootstrapEnvs.some((file) => Object.keys(file).some((key) => !env[key])) ||
    (!env.OMP_PROFILE && ("OMP_PROFILE" in startupEnv || "PI_PROFILE" in startupEnv)) ||
    Object.entries(startupEnv).some(
      ([key, value]) =>
        !env[key] && (value.includes("$") || key === "HOME" || key === "USERPROFILE"),
    )
  ) {
    throw new Error("Unknown OMP statistics bootstrap environment scope");
  }
  return { startupFile, env: mergeNativeScopeEnv(env, [startupEnv]) };
}

function applyNativeStatsProfile(
  env: Record<string, string>,
  home: string,
  profile: string | undefined,
): Record<string, string> {
  let inheritedProfile: string | undefined;
  try {
    inheritedProfile = normalizeProfile(
      env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE,
    );
  } catch {
    // Native module-load resolution defers invalid profile validation to CLI flags.
  }
  if (!inheritedProfile) {
    try {
      inheritedProfile = normalizeProfile(env.PI_PROFILE);
    } catch {
      // The native pre-profile snapshot also ignores an invalid legacy fallback.
    }
  }
  const base = join(home, env.PI_CONFIG_DIR || ".omp");
  const inheritedDir = inheritedProfile
    ? join(base, "profiles", inheritedProfile, "agent")
    : undefined;
  const preProfileAgentDir =
    env.PI_CODING_AGENT_DIR === inheritedDir ? undefined : env.PI_CODING_AGENT_DIR;
  const selected = { ...env };
  if (profile) {
    selected.OMP_PROFILE = profile;
    selected.PI_PROFILE = profile;
    selected.PI_CODING_AGENT_DIR = join(base, "profiles", profile, "agent");
  } else {
    // CLI setProfile(default) restores its module-load pre-profile snapshot
    // BEFORE env.ts locates agent .env. In particular OMP_PROFILE alone can
    // identify a parent's profile-derived override; PI_PROFILE need not exist.
    delete selected.OMP_PROFILE;
    delete selected.PI_PROFILE;
    if (preProfileAgentDir === undefined) delete selected.PI_CODING_AGENT_DIR;
    else selected.PI_CODING_AGENT_DIR = preProfileAgentDir;
  }
  return selected;
}

function resolveStatsDirectories({ env, home, cwd, profile }: StatsScopeContext): StatsDirectories {
  const base = join(home, env.PI_CONFIG_DIR || ".omp");
  const configRoot = profile ? join(base, "profiles", profile) : base;
  const defaultAgent = join(configRoot, "agent");
  if (profile || !env.PI_CODING_AGENT_DIR) return { configRoot, agentDir: defaultAgent };
  // Ignore a lower-priority PI_PROFILE's inherited, profile-derived agent dir.
  let inheritedProfile: string | undefined;
  try {
    inheritedProfile = normalizeProfile(env.PI_PROFILE);
  } catch {
    // Native dirs.ts ignores an invalid lower-priority profile here.
  }
  const inheritedDir = inheritedProfile
    ? join(base, "profiles", inheritedProfile, "agent")
    : undefined;
  const agentDir =
    env.PI_CODING_AGENT_DIR === inheritedDir ? defaultAgent : resolve(cwd, env.PI_CODING_AGENT_DIR);
  return { configRoot, agentDir };
}

function resolveStatsDataRoot(
  { env, cwd, platform, profile }: StatsScopeContext,
  { configRoot, agentDir }: StatsDirectories,
): string {
  if (
    !env.XDG_DATA_HOME ||
    (platform !== "linux" && platform !== "darwin") ||
    agentDir !== join(configRoot, "agent")
  )
    return configRoot;
  const candidate = resolve(
    cwd,
    env.XDG_DATA_HOME,
    "omp",
    ...(profile ? ["profiles", profile] : []),
  );
  return existsSync(candidate) ? candidate : configRoot;
}

/**
 * Mirrors v18.12.1 utils/dirs.ts getStatsDbPath (rootSubdir, not agentSubdir).
 * A custom PI_CODING_AGENT_DIR changes sessions/auth but never relocates stats.db;
 * it only disables XDG redirection. OMP_AGENT_DIR is not a native dirs.ts key.
 * The host-level catalog/management runtime launches from home, not a workspace.
 */
export function resolveOmpStatsSource(options: {
  env: NodeJS.ProcessEnv;
  command?: ProviderRuntimeSettings["command"];
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
}): StatsSource {
  const platform = options.platform ?? process.platform;
  const launchEnv = normalizeScopeEnv(options.env, platform, "launch");
  const home =
    options.home ?? (platform === "win32" ? launchEnv.USERPROFILE : launchEnv.HOME) ?? homedir();
  const cwd = options.cwd ?? home;
  const profile = resolveStatsProfile(launchEnv, options.command);
  const startup = readStatsStartupScope(launchEnv, cwd, platform);
  const scope: StatsScopeContext = {
    env: applyNativeStatsProfile(startup.env, home, profile),
    home,
    cwd,
    platform,
    profile,
  };
  // Raw Bun startup values affect these initial locations before env.ts reads
  // the agent/root files and applies literal uppercase OMP_* aliases.
  const initial = resolveStatsDirectories(scope);
  const directoryEnvs = [
    startup.startupFile,
    readScopeEnvFile(join(initial.agentDir, ".env"), platform),
    readScopeEnvFile(join(initial.configRoot, ".env"), platform),
    readScopeEnvFile(join(home, ".env"), platform),
  ].map((file) => normalizeScopeEnv(file, platform, "dotenv"));
  scope.env = mergeNativeScopeEnv(scope.env, directoryEnvs);
  const directories = resolveStatsDirectories(scope);
  return {
    path: join(resolveStatsDataRoot(scope, directories), "stats.db"),
    profile: profile ?? "default",
  };
}

/**
 * Read only the native /stats index. Never invoke `omp stats --json`: that command
 * ingests transcripts and writes user prose. No transcript or prose columns are read here.
 * Facts match stats/rollup.ts v18.12.1 but read raw numeric rows, avoiding stale rollups
 * during native reindexing. Each ingested request is counted exactly once by the native index.
 */
export async function readOmpStats(options: {
  range: OmpStatsRange;
  env: NodeJS.ProcessEnv;
  command?: ProviderRuntimeSettings["command"];
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  now?: number;
}): Promise<OmpStatsResult> {
  const now = options.now ?? Date.now();
  const metadata = {
    range: options.range,
    fetchedAt: new Date(now).toISOString(),
    source: "omp_stats_db" as const,
    scope: { kind: "host_profile" as const, profile: "default" },
  };
  let source: StatsSource;
  try {
    source = resolveOmpStatsSource(options);
    metadata.scope.profile = source.profile;
  } catch {
    return { ...metadata, status: "unavailable", reason: "scope_unavailable" };
  }
  try {
    await fs.stat(source.path);
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
      ? { ...metadata, status: "unavailable", reason: "missing" }
      : { ...metadata, status: "error", reason: "unreadable" };
  }
  const { promise, resolve: resolveResult } = Promise.withResolvers<OmpStatsResult>();
  const failure: OmpStatsResult = { ...metadata, status: "error", reason: "unreadable" };
  let worker: ChildProcess | undefined;
  let settled = false;
  let deadline: NodeJS.Timeout | undefined;
  try {
    const workerEnv: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const osEnvKeys =
      process.platform === "win32"
        ? ["SystemRoot", "WINDIR", "TMP", "TEMP"]
        : ["TMPDIR", "TMP", "TEMP"];
    for (const key of osEnvKeys) {
      if (process.env[key]) workerEnv[key] = process.env[key];
    }
    // Keep this literal URL discoverable by nft, and use plain JS in source
    // and dist so neither Vitest nor mini-electron needs a worker TS loader.
    worker = spawn(
      process.execPath,
      [fileURLToPath(new URL("./stats-worker.mjs", import.meta.url))],
      {
        env: workerEnv,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      },
    );
  } catch {
    finish(failure);
    return promise;
  }
  deadline = setTimeout(() => finish(failure), STATS_WORKER_TIMEOUT_MS);
  function finish(result: OmpStatsResult): void {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    // A process kill, unlike Worker.terminate(), also stops a synchronous
    // native SQLite scan. Keep the error handler until kill has been issued.
    if (worker) {
      worker.kill("SIGKILL");
      worker.off("message", onMessage);
      worker.off("error", onFailure);
      worker.off("exit", onExit);
      if (worker.connected) worker.disconnect();
    }
    resolveResult(result);
  }
  function onMessage(result: OmpStatsResult): void {
    finish(result);
  }
  function onFailure(): void {
    finish(failure);
  }
  function onExit(): void {
    finish(failure);
  }
  worker.once("message", onMessage);
  worker.on("error", onFailure);
  worker.once("exit", onExit);
  worker.send({ path: source.path, now, metadata }, (error) => {
    if (error) finish(failure);
  });
  return promise;
}

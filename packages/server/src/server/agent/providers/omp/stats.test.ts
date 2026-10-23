import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ProviderCommand } from "../../provider-launch-config.js";
import { readOmpStats, resolveOmpStatsSource } from "./stats.js";

vi.mock("node:child_process", async (importOriginal) => {
  const native = await importOriginal<{ spawn: typeof spawn }>();
  return { ...native, spawn: vi.fn(native.spawn) };
});

interface FixtureDatabase {
  exec(sql: string): void;
  prepare(sql: string): { run(...values: (string | number)[]): void; all(): unknown[] };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => FixtureDatabase;
};
const directories: string[] = [];
const NOW = Date.UTC(2026, 9, 18, 12);
const DAY = 86_400_000;
let entrySequence = 0;

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "omp-native-stats-"));
  directories.push(directory);
  return directory;
}

async function fixture(
  home: string,
  profile?: string,
  configDir = ".omp",
): Promise<FixtureDatabase> {
  const directory = profile ? join(home, configDir, "profiles", profile) : join(home, configDir);
  await mkdir(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "stats.db"));
  // Native v18.12.1 messages schema, pinned to can1357/oh-my-pi@291e055.
  database.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_file TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    api TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    duration INTEGER,
    ttft INTEGER,
    stop_reason TEXT NOT NULL,
    error_message TEXT,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    premium_requests REAL NOT NULL,
    cost_input REAL NOT NULL,
    cost_output REAL NOT NULL,
    cost_cache_read REAL NOT NULL,
    cost_cache_write REAL NOT NULL,
    cost_total REAL NOT NULL,
    cost_no_cache_input REAL,
    cost_unpriced INTEGER NOT NULL DEFAULT 0,
    agent_type TEXT NOT NULL DEFAULT 'main',
    service_tier TEXT,
    UNIQUE(session_file, entry_id)
  ); CREATE TABLE user_messages (prose TEXT);
  CREATE INDEX idx_messages_timestamp ON messages(timestamp);
  INSERT INTO user_messages VALUES ('private conversation text must never enter the result');`);
  return database;
}

function add(
  database: FixtureDatabase,
  values: {
    session?: string;
    provider?: string;
    model?: string;
    agent?: string;
    at?: number;
    stop?: string;
    cost?: number;
    unpriced?: number;
    total?: number;
  } = {},
): void {
  database
    .prepare(`INSERT INTO messages (
      session_file, entry_id, folder, model, provider, api, timestamp, stop_reason,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
      premium_requests, cost_input, cost_output, cost_cache_read, cost_cache_write,
      cost_total, cost_unpriced, agent_type, error_message
    ) VALUES (?, ?, '/private/project', ?, ?, 'fixture', ?, ?, 10, 20, 30, 40, ?,
      0, 0, 0, 0, 0, ?, ?, ?, ?)`)
    .run(
      values.session ?? "/private/project/main.jsonl",
      `entry-${++entrySequence}`,
      values.model ?? "claude-opus",
      values.provider ?? "anthropic",
      values.at ?? NOW,
      values.stop ?? "stop",
      values.total ?? 100,
      values.cost ?? 1.25,
      values.unpriced ?? 0,
      values.agent ?? "main",
      "/private/error/path",
    );
}

function controlledWorker() {
  const worker = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn().mockReturnValue(true),
    kill: vi.fn().mockReturnValue(true),
    disconnect: vi.fn(),
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  vi.mocked(spawn).mockImplementationOnce(() => {
    markStarted();
    return worker as unknown as ChildProcess;
  });
  return { worker, started };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.mocked(spawn).mockReset();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("read-only native /stats index", () => {
  it("reads native SQLite without executing daemon or provider preload hooks", async () => {
    const home = await temporaryHome();
    vi.stubEnv("TMPDIR", home);
    vi.stubEnv("TMP", home);
    vi.stubEnv("TEMP", home);
    vi.stubEnv("OMP_STATS_PRIVATE_API_KEY", "private-daemon-credential");
    vi.stubEnv("NODE_OPTIONS", "--import private-loader");
    const database = await fixture(home);
    add(database, { total: 160, cost: 7 });
    database.close();
    expect(
      await readOmpStats({
        home,
        env: {
          API_KEY: "private-launch-credential",
          NODE_OPTIONS: "--import private-provider-loader",
          TEMP: "/private-provider-temp",
          SystemRoot: "/private-provider-systemroot",
        },
        range: "all",
        now: NOW,
      }),
    ).toMatchObject({
      status: "available",
      overall: { totalRequests: 1, totalTokens: 160, totalCostUsd: 7 },
    });
  });

  it("uses the native rolling cutoff, aggregate facts and unpriced semantics without session/quota additions", async () => {
    const home = await temporaryHome();
    const database = await fixture(home);
    add(database, { at: NOW - DAY, cost: 2, total: 160 }); // Inclusive native range boundary.
    add(database, { model: "claude-sonnet", stop: "error", cost: 3 });
    add(database, {
      session: "/private/project/main/worker.jsonl",
      provider: "xai-oauth",
      model: "grok",
      agent: "subagent",
      cost: 0,
    });
    add(database, {
      session: "/private/project/main/__advisor.jsonl",
      provider: "local",
      model: "free",
      agent: "advisor",
      cost: 0,
    });
    add(database, { provider: "scheduled", model: "missing-time-card", cost: 0, unpriced: 1 });
    add(database, { at: NOW - DAY - 1, cost: 99 });
    database.close();

    const result = await readOmpStats({ range: "24h", env: {}, home, now: NOW });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected indexed metrics");
    expect(result.overall).toEqual({
      totalRequests: 5,
      failedRequests: 1,
      totalInputTokens: 50,
      totalOutputTokens: 100,
      totalCacheReadTokens: 150,
      totalCacheWriteTokens: 200,
      totalTokens: 560,
      totalCostUsd: 5,
      unpricedRequests: 2,
      transcriptCount: 3,
      firstTimestamp: NOW - DAY,
      lastTimestamp: NOW,
    });
    expect(result.indexedThrough).toBe(NOW);
    expect(result.byProvider.find((row) => row.provider === "anthropic")).toMatchObject({
      totalRequests: 2,
      transcriptCount: 1,
      totalCostUsd: 5,
      totalTokens: 260,
    });
    expect(result.byAgentType.map((row) => [row.agentType, row.totalRequests])).toEqual([
      ["advisor", 1],
      ["main", 3],
      ["subagent", 1],
    ]);
    expect(result.byModel.reduce((sum, row) => sum + row.totalRequests, 0)).toBe(5);
    expect(JSON.stringify(result)).not.toContain("private");
    const unchanged = new DatabaseSync(join(home, ".omp", "stats.db"));
    expect(unchanged.prepare("SELECT COUNT(*) AS n FROM messages").all()).toEqual([{ n: 6 }]);
    unchanged.close();
    const all = await readOmpStats({ range: "all", env: {}, home, now: NOW });
    expect(all.status === "available" && all.overall.totalRequests).toBe(6);
  });

  it("separates an empty range/index from missing, incompatible and corrupt sources", async () => {
    const home = await temporaryHome();
    expect(await readOmpStats({ range: "7d", env: {}, home, now: NOW })).toMatchObject({
      status: "unavailable",
      reason: "missing",
    });
    const database = await fixture(home);
    database.close();
    const empty = await readOmpStats({ range: "7d", env: {}, home, now: NOW });
    expect(empty).toMatchObject({
      status: "available",
      indexedThrough: null,
      byModel: [],
      overall: {
        totalRequests: 0,
        totalCostUsd: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      },
    });
    const old = await fixture(home, "old");
    add(old, { at: NOW - 100 * DAY });
    old.close();
    const inactive = await readOmpStats({
      range: "1h",
      env: { OMP_PROFILE: "old" },
      home,
      now: NOW,
    });
    expect(inactive).toMatchObject({
      status: "available",
      indexedThrough: NOW - 100 * DAY,
      overall: { totalRequests: 0 },
    });
    const incompatibleHome = await temporaryHome();
    await mkdir(join(incompatibleHome, ".omp"));
    new DatabaseSync(join(incompatibleHome, ".omp", "stats.db")).close();
    expect(await readOmpStats({ range: "all", env: {}, home: incompatibleHome })).toMatchObject({
      status: "unavailable",
      reason: "unsupported_schema",
    });
    await writeFile(join(home, ".omp", "stats.db"), "not a sqlite database");
    const corrupt = await readOmpStats({ range: "all", env: {}, home });
    expect(corrupt).toMatchObject({ status: "error", reason: "unreadable" });
    expect(JSON.stringify(corrupt)).not.toContain(home);
  });

  it("rejects invalid native facts and never returns partial fabricated totals", async () => {
    const home = await temporaryHome();
    const database = await fixture(home);
    add(database);
    database.exec("UPDATE messages SET input_tokens = 'bad numeric data'");
    database.close();
    expect(await readOmpStats({ range: "all", env: {}, home })).toMatchObject({
      status: "error",
      reason: "invalid_data",
    });
    const reopened = new DatabaseSync(join(home, ".omp", "stats.db"));
    try {
      // Invalid-data early returns must release the readonly transaction too.
      reopened.exec("BEGIN EXCLUSIVE; COMMIT");
    } finally {
      reopened.close();
    }
  });

  it("refreshes from the selected host/profile only", async () => {
    const firstHome = await temporaryHome();
    const secondHome = await temporaryHome();
    const first = await fixture(firstHome);
    const work = await fixture(firstHome, "work");
    const second = await fixture(secondHome);
    add(first, { cost: 1 });
    add(work, { cost: 7 });
    add(second, { cost: 9 });
    expect(
      await readOmpStats({
        range: "all",
        env: { OMP_PROFILE: "work", PI_PROFILE: "other" },
        home: firstHome,
      }),
    ).toMatchObject({
      status: "available",
      scope: { profile: "work" },
      overall: { totalCostUsd: 7 },
    });
    expect(await readOmpStats({ range: "all", env: {}, home: secondHome })).toMatchObject({
      status: "available",
      overall: { totalCostUsd: 9 },
    });
    add(work, { cost: 2 });
    expect(
      await readOmpStats({ range: "all", env: { OMP_PROFILE: "work" }, home: firstHome }),
    ).toMatchObject({ status: "available", overall: { totalCostUsd: 9 } });
    first.close();
    work.close();
    second.close();
  });
});

describe("bounded native stats worker lifecycle", () => {
  it.each(["error", "exit", "send-error"] as const)(
    "returns a sanitized result when the worker reports %s",
    async (event) => {
      const home = await temporaryHome();
      (await fixture(home)).close();
      const { worker, started } = controlledWorker();
      const pending = readOmpStats({ home, env: {}, range: "all", now: NOW });
      await started;
      if (event === "send-error") {
        const onSend = worker.send.mock.calls[0]![1] as (error: Error | null) => void;
        onSend(new Error(`${home}/private IPC error`));
      } else {
        worker.emit(event, event === "exit" ? 0 : new Error(`${home}/private SQLite error`));
      }
      const result = await pending;
      expect(result).toMatchObject({ status: "error", reason: "unreadable" });
      expect(JSON.stringify(result)).not.toContain(home);
    },
  );

  it("returns an explicit error for a stalled read before the client deadline", async () => {
    const home = await temporaryHome();
    (await fixture(home)).close();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { started } = controlledWorker();
    const pending = readOmpStats({ home, env: {}, range: "all", now: NOW });
    await started;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(await pending).toMatchObject({ status: "error", reason: "unreadable" });
  });

  it("sanitizes worker startup failures instead of returning zero usage", async () => {
    const home = await temporaryHome();
    (await fixture(home)).close();
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error(`${home}/private runtime loader`);
    });
    const result = await readOmpStats({ home, env: {}, range: "all", now: NOW });
    expect(result).toMatchObject({ status: "error", reason: "unreadable" });
    expect(JSON.stringify(result)).not.toContain(home);
  });
});

describe("native stats directory scoping", () => {
  it("honors native profile precedence and keeps stats outside a custom agent directory", async () => {
    const home = await temporaryHome();
    expect(
      resolveOmpStatsSource({
        home,
        env: { OMP_PROFILE: "", PI_PROFILE: "work", OMP_AGENT_DIR: "/ignored" },
      }),
    ).toEqual({ path: join(home, ".omp", "stats.db"), profile: "default" });
    expect(
      resolveOmpStatsSource({
        home,
        env: { PI_PROFILE: "work", PI_CODING_AGENT_DIR: "/custom-agent" },
      }),
    ).toEqual({ path: join(home, ".omp", "profiles", "work", "stats.db"), profile: "work" });
    expect(
      resolveOmpStatsSource({
        home,
        env: { PI_CONFIG_DIR: ".custom", PI_CODING_AGENT_DIR: "/custom-agent" },
      }),
    ).toEqual({ path: join(home, ".custom", "stats.db"), profile: "default" });
    expect(resolveOmpStatsSource({ env: { HOME: home }, platform: "linux" }).path).toBe(
      join(home, ".omp", "stats.db"),
    );
    expect(
      resolveOmpStatsSource({
        home,
        env: {},
        command: { mode: "append", args: ["--profile=work"] },
      }).profile,
    ).toBe("work");
    expect(() => resolveOmpStatsSource({ home, env: { OMP_PROFILE: "../other" } })).toThrow();
    expect(
      await readOmpStats({
        home,
        range: "all",
        env: {},
        command: { mode: "replace", argv: ["wrapper.cmd"] },
      }),
    ).toMatchObject({ status: "unavailable", reason: "scope_unavailable" });
  });

  it("matches native XDG opt-in, profile existence and agent-override rules", async () => {
    const home = await temporaryHome();
    const data = join(home, "xdg");
    const env = { XDG_DATA_HOME: data };
    await mkdir(join(data, "omp"), { recursive: true });
    expect(resolveOmpStatsSource({ home, env, platform: "linux" }).path).toBe(
      join(data, "omp", "stats.db"),
    );
    expect(resolveOmpStatsSource({ home, env, platform: "win32" }).path).toBe(
      join(home, ".omp", "stats.db"),
    );
    expect(
      resolveOmpStatsSource({
        home,
        env: { ...env, PI_CODING_AGENT_DIR: join(home, "custom") },
        platform: "linux",
      }).path,
    ).toBe(join(home, ".omp", "stats.db"));
    expect(
      resolveOmpStatsSource({ home, env: { ...env, OMP_PROFILE: "work" }, platform: "linux" }).path,
    ).toBe(join(home, ".omp", "profiles", "work", "stats.db"));
    await mkdir(join(data, "omp", "profiles", "work"), { recursive: true });
    expect(
      resolveOmpStatsSource({ home, env: { ...env, OMP_PROFILE: "work" }, platform: "linux" }).path,
    ).toBe(join(data, "omp", "profiles", "work", "stats.db"));
  });

  it("loads directory-only native dotenv values without replacing launcher values", async () => {
    const home = await temporaryHome();
    await mkdir(join(home, ".omp", "agent"), { recursive: true });
    await writeFile(
      join(home, ".omp", "agent", ".env"),
      "OMP_CONFIG_DIR=.from-agent\nAPI_KEY=never-exposed\n",
    );
    expect(resolveOmpStatsSource({ home, env: {} }).path).toBe(
      join(home, ".from-agent", "stats.db"),
    );
    expect(resolveOmpStatsSource({ home, env: { PI_CONFIG_DIR: ".launcher" } }).path).toBe(
      join(home, ".launcher", "stats.db"),
    );
  });

  it("keeps the host launch cwd distinct from an overridden runtime home", async () => {
    const home = await temporaryHome();
    const cwd = await temporaryHome();
    await writeFile(join(home, ".env"), "PI_CONFIG_DIR=.home-config\n");
    await writeFile(join(cwd, ".env"), "PI_CONFIG_DIR=.launch-config\n");
    expect(resolveOmpStatsSource({ home, cwd, env: {} }).path).toBe(
      join(home, ".launch-config", "stats.db"),
    );
  });

  it("does not silently choose the default index when Bun startup dotenv can change scope", async () => {
    const home = await temporaryHome();
    await writeFile(join(home, ".env.local"), "PI_CONFIG_DIR=.bun-local\n");
    expect(await readOmpStats({ home, env: {}, range: "24h" })).toMatchObject({
      status: "unavailable",
      reason: "scope_unavailable",
    });
    await rm(join(home, ".env.local"));
    await writeFile(join(home, ".env"), "OMP_PROFILE=work\n");
    expect(await readOmpStats({ home, env: {}, range: "24h" })).toMatchObject({
      status: "unavailable",
      reason: "scope_unavailable",
    });
  });

  it("matches Windows case-insensitive launch scope without changing POSIX lookups", async () => {
    const home = await temporaryHome();
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, "work");
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    defaultIndex.close();
    workIndex.close();
    expect(
      await readOmpStats({
        range: "all",
        platform: "win32",
        env: { userprofile: home, omp_profile: "work", pi_profile: "other" },
      }),
    ).toMatchObject({
      status: "available",
      scope: { profile: "work" },
      overall: { totalCostUsd: 7 },
    });
    expect(
      await readOmpStats({
        home,
        range: "all",
        platform: "linux",
        env: { omp_profile: "work", pi_profile: "other" },
      }),
    ).toMatchObject({
      status: "available",
      scope: { profile: "default" },
      overall: { totalCostUsd: 1 },
    });
  });

  it("uses Node spawn's lexicographic first key after Windows base/overlay merges", async () => {
    const home = await temporaryHome();
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, "work");
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    defaultIndex.close();
    workIndex.close();
    const cases: Array<{ env: NodeJS.ProcessEnv; cost: number }> = [
      { env: { omp_profile: "work", OMP_PROFILE: "default" }, cost: 1 },
      { env: { OMP_PROFILE: "default", omp_profile: "work" }, cost: 1 },
      { env: { omp_profile: "default", OMP_PROFILE: "work" }, cost: 7 },
      { env: { OMP_PROFILE: "work", omp_profile: "default" }, cost: 7 },
      { env: { OMP_PROFILE: undefined, omp_profile: "work" }, cost: 7 },
      { env: { OMP_PROFILE: "", omp_profile: "work" }, cost: 1 },
    ];
    for (const { env, cost } of cases) {
      expect(await readOmpStats({ home, env, range: "all", platform: "win32" })).toMatchObject({
        status: "available",
        overall: { totalCostUsd: cost },
      });
    }
  });

  it("supports lowercase dotenv keys and rejects cross-runtime ambiguous Windows casing", async () => {
    const home = await temporaryHome();
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, undefined, ".work");
    const otherIndex = await fixture(home, undefined, ".other");
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    add(otherIndex, { cost: 11 });
    defaultIndex.close();
    workIndex.close();
    otherIndex.close();
    await mkdir(join(home, ".omp", "agent"), { recursive: true });
    await writeFile(join(home, ".omp", "agent", ".env"), "pi_config_dir=.work\n");
    expect(await readOmpStats({ home, env: {}, range: "all", platform: "win32" })).toMatchObject({
      status: "available",
      overall: { totalCostUsd: 7 },
    });
    expect(await readOmpStats({ home, env: {}, range: "all", platform: "linux" })).toMatchObject({
      status: "available",
      overall: { totalCostUsd: 1 },
    });
    await writeFile(
      join(home, ".omp", "agent", ".env"),
      "pi_config_dir=.work\nPI_CONFIG_DIR=.other\n",
    );
    const ambiguous = await readOmpStats({ home, env: {}, range: "all", platform: "win32" });
    expect(ambiguous).toMatchObject({ status: "unavailable", reason: "scope_unavailable" });
    expect(ambiguous).not.toHaveProperty("overall");
    expect(await readOmpStats({ home, env: {}, range: "all", platform: "linux" })).toMatchObject({
      status: "available",
      overall: { totalCostUsd: 11 },
    });
  });

  it("rejects Windows dotenv casing duplicates instead of guessing an index", async () => {
    const home = await temporaryHome();
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, undefined, ".work");
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    defaultIndex.close();
    workIndex.close();
    await mkdir(join(home, ".omp", "agent"), { recursive: true });
    const path = join(home, ".omp", "agent", ".env");
    // Actual packaged Bun 1.4.3 folds to the last declaration and retains its
    // first spelling. Node 24 parseEnv exposes separately sorted case variants,
    // losing the source order; neither direction may silently select an index.
    for (const text of [
      "pi_config_dir=.work\nPI_CONFIG_DIR=.other\n",
      "PI_CONFIG_DIR=.other\npi_config_dir=.work\n",
      "pi_config_dir=\nPI_CONFIG_DIR=.work\n",
      "PI_CONFIG_DIR=.work\npi_config_dir=\n",
      "PI_CONFIG_DIR=\npi_config_dir=.work\n",
      "pi_config_dir=.work\nPI_CONFIG_DIR=\n",
      "PI_CONFIG_DIR=.old\npi_config_dir=.middle\nPI_CONFIG_DIR=.work\n",
      // The retained OMP_ spelling also controls native alias creation.
      "omp_config_dir=.work\nOMP_CONFIG_DIR=.work\n",
      "pi_config_dir=.work\nPI_CONFIG_DIR=.work\n",
    ]) {
      await writeFile(path, text);
      const result = await readOmpStats({ home, env: {}, range: "all", platform: "win32" });
      expect(result).toMatchObject({ status: "unavailable", reason: "scope_unavailable" });
      expect(result).not.toHaveProperty("overall");
    }
  });

  it("never attributes Windows stats to an ambiguous native alias scope", async () => {
    const home = await temporaryHome();
    for (const [directory, cost] of [
      [".omp", 1],
      [".work", 7],
      [".other", 11],
    ] as const) {
      const db = await fixture(home, undefined, directory);
      add(db, { cost });
      db.close();
    }
    await mkdir(join(home, ".omp", "agent"), { recursive: true });
    for (const text of [
      "pi_config_dir=.other\nPI_CONFIG_DIR=.other\nOMP_CONFIG_DIR=.work\n",
      "OMP_config_dir=.work\nOMP_CONFIG_DIR=.work\nPI_CONFIG_DIR=.other\n",
    ]) {
      await writeFile(join(home, ".omp", "agent", ".env"), text);
      const result = await readOmpStats({ home, env: {}, range: "all", platform: "win32" });
      expect(result).toMatchObject({ status: "unavailable", reason: "scope_unavailable" });
      expect(result).not.toHaveProperty("overall");
    }
  });

  it("lets native OMP aliases replace an empty case-insensitive dotenv value", async () => {
    const home = await temporaryHome();
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, undefined, ".work");
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    defaultIndex.close();
    workIndex.close();
    await mkdir(join(home, ".omp", "agent"), { recursive: true });
    const path = join(home, ".omp", "agent", ".env");
    // Confirmed against parseEnv + native parseEnvFile/!Bun.env merging in the
    // packaged runtime: the later PI_CONFIG_DIR alias fills the empty value.
    for (const text of [
      "pi_config_dir=\nOMP_CONFIG_DIR=.work\n",
      "OMP_CONFIG_DIR=.work\npi_config_dir=\n",
      "pi_config_dir=.work\nOMP_CONFIG_DIR=.other\n",
    ]) {
      await writeFile(path, text);
      expect(await readOmpStats({ home, env: {}, range: "all", platform: "win32" })).toMatchObject({
        status: "available",
        overall: { totalCostUsd: 7 },
      });
    }
    await writeFile(path, "omp_config_dir=.work\n");
    expect(await readOmpStats({ home, env: {}, range: "all", platform: "win32" })).toMatchObject({
      status: "available",
      overall: { totalCostUsd: 1 },
    });
  });

  it("does not bypass bootstrap scope guards with lowercase Windows dotenv keys", async () => {
    const home = await temporaryHome();
    await writeFile(join(home, ".env.local"), "omp_profile=work\n");
    expect(await readOmpStats({ home, env: {}, range: "all", platform: "win32" })).toMatchObject({
      status: "unavailable",
      reason: "scope_unavailable",
    });
    await rm(join(home, ".env.local"));
    await writeFile(join(home, ".env"), "pi_config_dir=.work\nPI_CONFIG_DIR=.other\n");
    expect(await readOmpStats({ home, env: {}, range: "all", platform: "win32" })).toMatchObject({
      status: "unavailable",
      reason: "scope_unavailable",
    });
  });

  it("applies startup agent-directory values before locating native agent dotenv", async () => {
    const home = await temporaryHome();
    const cwd = await temporaryHome();
    const agent = join(cwd, "work-agent");
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, undefined, ".work");
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    defaultIndex.close();
    workIndex.close();
    await mkdir(agent, { recursive: true });
    await writeFile(join(cwd, ".env"), `PI_CODING_AGENT_DIR=${agent.replaceAll("\\", "/")}\n`);
    await writeFile(join(agent, ".env"), "PI_CONFIG_DIR=.work\n");
    expect(await readOmpStats({ home, cwd, env: {}, range: "all" })).toMatchObject({
      status: "available",
      overall: { totalCostUsd: 7 },
    });
    await writeFile(join(cwd, ".env"), `pi_coding_agent_dir=${agent.replaceAll("\\", "/")}\n`);
    await writeFile(join(agent, ".env"), "pi_config_dir=.work\n");
    expect(
      await readOmpStats({ home, cwd, env: {}, range: "all", platform: "win32" }),
    ).toMatchObject({ status: "available", overall: { totalCostUsd: 7 } });
  });

  it("applies startup config-root values before locating native root and agent dotenv", async () => {
    const home = await temporaryHome();
    const cwd = await temporaryHome();
    const data = join(home, "xdg");
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, undefined, join("xdg", "omp"));
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    defaultIndex.close();
    workIndex.close();
    await mkdir(join(home, ".startup", "agent"), { recursive: true });
    await writeFile(join(cwd, ".env"), "PI_CONFIG_DIR=.startup\n");
    await writeFile(
      join(home, ".startup", "agent", ".env"),
      `XDG_DATA_HOME=${data.replaceAll("\\", "/")}\n`,
    );
    expect(
      await readOmpStats({ home, cwd, env: {}, range: "all", platform: "linux" }),
    ).toMatchObject({ status: "available", overall: { totalCostUsd: 7 } });
  });

  it("resets OMP_PROFILE-derived agent dotenv before an explicit default profile", async () => {
    const home = await temporaryHome();
    for (const [directory, cost] of [
      [".from-default", 2],
      [".from-work", 9],
      [".from-explicit-agent", 13],
    ] as const) {
      const database = await fixture(home, undefined, directory);
      add(database, { cost });
      database.close();
    }
    const defaultAgent = join(home, ".omp", "agent");
    const workAgent = join(home, ".omp", "profiles", "work", "agent");
    const explicitAgent = join(home, "explicit-agent");
    for (const [agent, config] of [
      [defaultAgent, ".from-default"],
      [workAgent, ".from-work"],
      [explicitAgent, ".from-explicit-agent"],
    ] as const) {
      await mkdir(agent, { recursive: true });
      await writeFile(join(agent, ".env"), `PI_CONFIG_DIR=${config}\n`);
    }
    for (const platform of ["linux", "win32"] as const) {
      for (const command of [
        { mode: "append", args: ["--profile=default"] },
        { mode: "replace", argv: ["omp", "--profile", "default"] },
      ] satisfies ProviderCommand[]) {
        const result = await readOmpStats({
          home,
          env: { OMP_PROFILE: "work", PI_CODING_AGENT_DIR: workAgent },
          range: "all",
          now: NOW,
          platform,
          command,
        });
        expect(result).toMatchObject({
          status: "available",
          scope: { profile: "default" },
          overall: { totalCostUsd: 2 },
        });
      }
    }
    // A non-derived pre-profile override is the user's baseline and is retained.
    expect(
      await readOmpStats({
        home,
        env: { OMP_PROFILE: "work", PI_CODING_AGENT_DIR: explicitAgent },
        range: "all",
        now: NOW,
        command: { mode: "append", args: ["--profile=default"] },
      }),
    ).toMatchObject({
      status: "available",
      scope: { profile: "default" },
      overall: { totalCostUsd: 13 },
    });
  });

  it("uses only the final explicit profile before validating inherited or repeated values", async () => {
    const home = await temporaryHome();
    const defaultIndex = await fixture(home);
    const workIndex = await fixture(home, "work");
    add(defaultIndex, { cost: 1 });
    add(workIndex, { cost: 7 });
    defaultIndex.close();
    workIndex.close();
    for (const env of [
      { OMP_PROFILE: "../invalid" },
      { PI_PROFILE: "../invalid" },
      { OMP_PROFILE: "../invalid", PI_PROFILE: "other" },
    ]) {
      expect(
        await readOmpStats({
          home,
          env,
          range: "all",
          command: { mode: "append", args: ["--profile=work"] },
        }),
      ).toMatchObject({
        status: "available",
        scope: { profile: "work" },
        overall: { totalCostUsd: 7 },
      });
      expect(
        await readOmpStats({
          home,
          env,
          range: "all",
          command: { mode: "replace", argv: ["omp", "--profile", "work"] },
        }),
      ).toMatchObject({
        status: "available",
        scope: { profile: "work" },
        overall: { totalCostUsd: 7 },
      });
      expect(
        await readOmpStats({
          home,
          env,
          range: "all",
          command: { mode: "append", args: ["--profile=default"] },
        }),
      ).toMatchObject({
        status: "available",
        scope: { profile: "default" },
        overall: { totalCostUsd: 1 },
      });
    }
    expect(
      await readOmpStats({
        home,
        env: { OMP_PROFILE: "../invalid" },
        range: "all",
        command: { mode: "append", args: ["--profile=../earlier-invalid", "--profile=work"] },
      }),
    ).toMatchObject({
      status: "available",
      scope: { profile: "work" },
      overall: { totalCostUsd: 7 },
    });
    expect(
      await readOmpStats({ home, env: { OMP_PROFILE: "../invalid" }, range: "all" }),
    ).toMatchObject({ status: "unavailable", reason: "scope_unavailable" });
  });
});

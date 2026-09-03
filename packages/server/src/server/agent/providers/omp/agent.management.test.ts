import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";
import { parse } from "yaml";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import {
  disableStoredOmpCredential,
  disableStoredOmpProviderCredentials,
  formatOmpModelsYaml,
  readStoredOmpOAuthAccounts,
  readStoredOmpSessionCredentialId,
  OmpAgentClient,
} from "./agent.js";
import { FakeOmp } from "./test-utils/fake-omp.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const testRequire = createRequire(import.meta.url);
interface TestSqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
}
const { DatabaseSync } = testRequire("node:sqlite") as {
  DatabaseSync: new (path: string) => TestSqliteDatabase;
};

async function createClient(options: { quotaFetch?: typeof fetch } = {}) {
  const agentDir = await mkdtemp(path.join(tmpdir(), "omp-desktop-management-"));
  tempDirs.push(agentDir);
  const runtime = new FakeOmp();
  const client = new OmpAgentClient({
    logger: createTestLogger(),
    runtime,
    runtimeSettings: { env: { PI_CODING_AGENT_DIR: agentDir } },
    quotaFetch: options.quotaFetch ?? (async () => new Response(null, { status: 401 })),
  });
  return { agentDir, client, runtime };
}

describe("OMP provider management", () => {
  test("reads native models and subscription state", async () => {
    const { agentDir, client, runtime } = await createClient();
    runtime.queueModels([
      { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      { provider: "anthropic", id: "claude-opus-4", name: "Claude Opus 4" },
      { provider: "openai", id: "gpt-5", name: "GPT-5" },
    ]);
    runtime.queueLoginProviders([
      { id: "anthropic", name: "Anthropic", available: true, authenticated: true },
      { id: "openai", name: "OpenAI", available: true, authenticated: false },
    ]);

    await expect(client.getOmpProviderManagement()).resolves.toEqual({
      configPath: path.join(agentDir, "models.yml"),
      configYaml: "providers: {}\n",
      providerModels: [
        {
          id: "anthropic",
          modelCount: 2,
          source: "built-in",
          models: [
            { id: "claude-opus-4", name: "Claude Opus 4" },
            { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
          ],
        },
        {
          id: "openai",
          modelCount: 1,
          source: "built-in",
          models: [{ id: "gpt-5", name: "GPT-5" }],
        },
      ],
      loginProviders: [
        { id: "anthropic", name: "Anthropic", available: true, authenticated: true },
        { id: "openai", name: "OpenAI", available: true, authenticated: false },
      ],
    });
  });
  test("reports every active OAuth account without exposing credential data", async () => {
    const quotaFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get("Authorization") === "Bearer secret-a") {
        return new Response(
          JSON.stringify({
            plan_type: "plus",
            rate_limit: {
              primary_window: { used_percent: 42, reset_at: 1_798_122_000 },
              secondary_window: { used_percent: 8, reset_at: 1_798_640_000 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(null, { status: 401 });
    });
    const { agentDir, client, runtime } = await createClient({ quotaFetch });
    const databasePath = path.join(agentDir, "agent.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT NOT NULL,
        disabled_cause TEXT,
        identity_key TEXT
      );
      INSERT INTO auth_credentials
        (id, provider, credential_type, data, identity_key, disabled_cause)
      VALUES
        (1, 'openai-codex', 'oauth', '{"access":"secret-a","accountId":"acct-a"}', 'email:alice@example.com|org:personal', NULL),
        (2, 'openai-codex', 'oauth', '{"access":"secret-b","accountId":"acct-b"}', 'email:bob@example.com|org:team', NULL),
        (3, 'openai-codex', 'oauth', '{"access":"secret-c"}', 'email:old@example.com', 'expired'),
        (4, 'openai-codex', 'api_key', '{"key":"secret-d"}', NULL, NULL),
        (5, 'anthropic', 'oauth', '{"access":"secret-e"}', NULL, NULL);
    `);
    database.close();
    runtime.queueModels([]);
    runtime.queueLoginProviders([
      { id: "openai-codex", name: "OpenAI Codex", available: true, authenticated: true },
      { id: "anthropic", name: "Anthropic", available: true, authenticated: true },
    ]);

    expect(readStoredOmpOAuthAccounts(databasePath)).toEqual([
      {
        credentialId: 5,
        provider: "anthropic",
      },
      {
        credentialId: 1,
        provider: "openai-codex",
        identityKey: "email:alice@example.com|org:personal",
      },
      {
        credentialId: 2,
        provider: "openai-codex",
        identityKey: "email:bob@example.com|org:team",
      },
    ]);
    const management = await client.getOmpProviderManagement();
    expect(management).toMatchObject({
      loginProviders: [
        {
          id: "openai-codex",
          accounts: [
            {
              credentialId: 1,
              identityKey: "email:alice@example.com|org:personal",
              quota: {
                status: "available",
                planLabel: "plus",
                fiveHourUsedPct: 42,
                fiveHourLimitReached: false,
                weeklyUsedPct: 8,
              },
            },
            {
              credentialId: 2,
              identityKey: "email:bob@example.com|org:team",
              quota: {
                status: "unavailable",
                fiveHourUsedPct: null,
                fiveHourLimitReached: null,
              },
            },
          ],
        },
        {
          id: "anthropic",
          accounts: [{ credentialId: 5 }],
        },
      ],
    });
    expect(JSON.stringify(management)).not.toContain("secret-a");
    expect(JSON.stringify(management)).not.toContain("secret-b");
    expect(quotaFetch).toHaveBeenCalledTimes(2);
    expect(
      quotaFetch.mock.calls
        .map(([, init]) => new Headers(init?.headers).get("ChatGPT-Account-Id"))
        .sort(),
    ).toEqual(["acct-a", "acct-b"]);
  });
  test("reads the unexpired OAuth credential selected for an OMP session", async () => {
    const agentDir = await mkdtemp(path.join(tmpdir(), "omp-desktop-session-credential-"));
    tempDirs.push(agentDir);
    const databasePath = path.join(agentDir, "agent.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO cache (key, value, expires_at) VALUES
        (
          'session:sticky:openai-codex:active-session',
          '{"type":"oauth","credentialId":42}',
          4102444800
        ),
        (
          'session:sticky:openai-codex:expired-session',
          '{"type":"oauth","credentialId":41}',
          1
        );
    `);
    database.close();

    expect(readStoredOmpSessionCredentialId(databasePath, "openai-codex", "active-session")).toBe(
      42,
    );
    expect(
      readStoredOmpSessionCredentialId(databasePath, "openai-codex", "expired-session"),
    ).toBeUndefined();
  });
  test("reads refreshed OAuth credentials before the first quota request", async () => {
    const quotaFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      if (authorization !== "Bearer refreshed-token") {
        return new Response(null, { status: 401 });
      }
      return new Response(
        JSON.stringify({
          plan_type: "plus",
          rate_limit: {
            primary_window: { used_percent: 25, reset_at: 1_798_122_000 },
            secondary_window: { used_percent: 10, reset_at: 1_798_640_000 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const { agentDir, client, runtime } = await createClient({ quotaFetch });
    const databasePath = path.join(agentDir, "agent.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT NOT NULL,
        disabled_cause TEXT,
        identity_key TEXT
      );
      INSERT INTO auth_credentials
        (id, provider, credential_type, data, identity_key, disabled_cause)
      VALUES
        (1, 'openai-codex', 'oauth', '{"access":"stale-token","accountId":"acct-a"}', 'email:alice@example.com', NULL);
    `);
    database.close();
    runtime.queueModels([]);
    runtime.queueLoginProviders([
      { id: "openai-codex", name: "OpenAI Codex", available: true, authenticated: true },
    ]);
    const startSession = runtime.startSession.bind(runtime);
    runtime.startSession = async (input) => {
      const refreshedDatabase = new DatabaseSync(databasePath);
      refreshedDatabase.exec(
        `UPDATE auth_credentials SET data = '{"access":"refreshed-token","accountId":"acct-a"}' WHERE id = 1`,
      );
      refreshedDatabase.close();
      return startSession(input);
    };

    const management = await client.getOmpProviderManagement();

    expect(management.loginProviders[0]?.accounts?.[0]?.quota).toMatchObject({
      status: "available",
      fiveHourUsedPct: 25,
      weeklyUsedPct: 10,
    });
    expect(quotaFetch).toHaveBeenCalledTimes(1);
  });
  test("persists account order without overriding OMP automatic selection", async () => {
    const { agentDir, client, runtime } = await createClient();
    const database = new DatabaseSync(path.join(agentDir, "agent.db"));
    database.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT NOT NULL,
        disabled_cause TEXT,
        identity_key TEXT
      );
      INSERT INTO auth_credentials
        (id, provider, credential_type, data, identity_key, disabled_cause)
      VALUES
        (1, 'openai-codex', 'oauth', '{"access":"secret-a"}', 'email:alice@example.com', NULL),
        (2, 'openai-codex', 'oauth', '{"access":"secret-b"}', 'email:bob@example.com', NULL);
      CREATE TABLE cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO cache (key, value, expires_at) VALUES
        (
          'session:sticky:openai-codex:omp-session-1',
          '{"type":"oauth","credentialId":1}',
          4102444800
        );
    `);
    database.close();
    const providers = [
      { id: "openai-codex", name: "OpenAI Codex", available: true, authenticated: true },
    ];
    runtime.queueModels([]);
    runtime.queueLoginProviders(providers);
    runtime.queueModels([]);
    runtime.queueLoginProviders(providers);

    const management = await client.reorderOmpProviderAccounts("openai-codex", [2, 1]);

    expect(management.loginProviders[0]?.accounts?.map((account) => account.credentialId)).toEqual([
      2, 1,
    ]);
    await expect(
      readFile(path.join(agentDir, "omp-desktop-account-order.json"), "utf8"),
    ).resolves.toContain('"openai-codex": [\n    2,\n    1\n  ]');
    runtime.setInitialModel({ provider: "openai-codex", id: "gpt-5.6" });
    const session = await client.createSession({
      provider: "omp",
      cwd: agentDir,
      model: "openai-codex/gpt-5.6",
    });
    expect(runtime.latestSession().prompts).toEqual([]);
    expect(session.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "oauth_account_credential",
          value: "automatic",
          effectiveValue: "1",
        }),
      ]),
    );
  });
  test("cancels an active provider login and closes its runtime session", async () => {
    const { client, runtime } = await createClient();
    runtime.queueLoginFlow({
      url: "https://example.test/oauth",
      launchUrl: "https://example.test/oauth?launch=1",
    });

    const flow = await client.startOmpProviderLogin("openai-codex");
    const session = runtime.latestSession();
    expect(flow).toMatchObject({
      providerId: "openai-codex",
      url: "https://example.test/oauth",
    });
    expect(session.loginRequests).toEqual(["openai-codex"]);
    expect(session.closed).toBe(false);

    await expect(client.cancelOmpProviderLogin(flow.flowId)).resolves.toBe(true);
    expect(session.closed).toBe(true);
    await expect(client.cancelOmpProviderLogin(flow.flowId)).resolves.toBe(false);
  });

  test("logs out only active credentials for the requested provider", async () => {
    const agentDir = await mkdtemp(path.join(tmpdir(), "omp-desktop-auth-"));
    tempDirs.push(agentDir);
    const databasePath = path.join(agentDir, "agent.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        disabled_cause TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO auth_credentials (id, provider) VALUES
        (1, 'openai-codex'),
        (2, 'anthropic'),
        (3, 'openai-codex');
      UPDATE auth_credentials SET disabled_cause = 'expired' WHERE id = 3;
    `);
    database.close();

    expect(disableStoredOmpProviderCredentials(databasePath, "openai-codex")).toBe(1);

    const verification = new DatabaseSync(databasePath);
    const rows = verification
      .prepare("SELECT id, disabled_cause FROM auth_credentials ORDER BY id")
      .all();
    verification.close();
    expect(rows).toEqual([
      { id: 1, disabled_cause: "deleted by user" },
      { id: 2, disabled_cause: null },
      { id: 3, disabled_cause: "expired" },
    ]);
  });

  test("logs out only the requested OAuth credential", async () => {
    const agentDir = await mkdtemp(path.join(tmpdir(), "omp-desktop-auth-"));
    tempDirs.push(agentDir);
    const databasePath = path.join(agentDir, "agent.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        disabled_cause TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO auth_credentials (id, provider, credential_type) VALUES
        (1, 'openai-codex', 'oauth'),
        (2, 'openai-codex', 'oauth'),
        (3, 'openai-codex', 'apiKey'),
        (4, 'anthropic', 'oauth');
    `);
    database.close();

    expect(disableStoredOmpCredential(databasePath, "openai-codex", 2)).toBe(1);
    expect(disableStoredOmpCredential(databasePath, "anthropic", 1)).toBe(0);
    expect(disableStoredOmpCredential(databasePath, "openai-codex", 3)).toBe(0);

    const verification = new DatabaseSync(databasePath);
    const rows = verification
      .prepare("SELECT id, disabled_cause FROM auth_credentials ORDER BY id")
      .all();
    verification.close();
    expect(rows).toEqual([
      { id: 1, disabled_cause: null },
      { id: 2, disabled_cause: "deleted by user" },
      { id: 3, disabled_cause: null },
      { id: 4, disabled_cause: null },
    ]);
  });

  test("reports built-in model context-window overrides without treating them as custom", async () => {
    const { agentDir, client, runtime } = await createClient();
    await writeFile(
      path.join(agentDir, "models.yml"),
      `providers:
  openai-codex:
    modelOverrides:
      gpt-5.6-sol:
        contextWindow: 1000000
`,
      "utf8",
    );
    runtime.queueModels([
      {
        provider: "openai-codex",
        id: "gpt-5.6-sol",
        name: "GPT-5.6-Sol",
        contextWindow: 1_000_000,
      },
    ]);
    runtime.queueLoginProviders([
      {
        id: "openai-codex",
        name: "OpenAI Codex",
        available: true,
        authenticated: true,
      },
    ]);

    await expect(client.getOmpProviderManagement()).resolves.toMatchObject({
      providerModels: [
        {
          id: "openai-codex",
          modelCount: 1,
          source: "built-in",
          models: [
            {
              id: "gpt-5.6-sol",
              name: "GPT-5.6-Sol",
              contextWindow: 1_000_000,
              contextWindowOverride: 1_000_000,
            },
          ],
        },
      ],
    });
  });

  test("updates only requested model context-window overrides", async () => {
    const { agentDir, client, runtime } = await createClient();
    const configPath = path.join(agentDir, "models.yml");
    await writeFile(
      configPath,
      `# Keep this comment
providers:
  openai-codex:
    modelOverrides:
      gpt-empty:
        contextWindow: 32000
      gpt-sibling:
        contextWindow: 64000
        maxTokens: 4096
  mintcat:
    baseUrl: https://api.example.test/v1
`,
      "utf8",
    );
    runtime.queueModels([]);
    runtime.queueLoginProviders([]);
    runtime.queueModels([]);
    runtime.queueLoginProviders([]);

    await client.updateOmpModelContextWindowOverrides("openai-codex", {
      "gpt-empty": null,
      "gpt-sibling": null,
      "gpt-new": 1_000_000,
    });

    const updatedYaml = await readFile(configPath, "utf8");
    expect(updatedYaml).toContain("# Keep this comment");
    expect(parse(updatedYaml)).toEqual({
      providers: {
        "openai-codex": {
          modelOverrides: {
            "gpt-sibling": { maxTokens: 4096 },
            "gpt-new": { contextWindow: 1_000_000 },
          },
        },
        mintcat: { baseUrl: "https://api.example.test/v1" },
      },
    });
  });

  test("rejects invalid context-window overrides before starting OMP", async () => {
    const { client, runtime } = await createClient();

    await expect(
      client.updateOmpModelContextWindowOverrides("openai-codex", {
        "gpt-5.6-sol": 1.5,
      }),
    ).rejects.toThrow("Invalid OMP context window");
    expect(runtime.recordedLaunches).toHaveLength(0);
  });
  test("formats models.yml as readable block YAML and preserves comments", () => {
    expect(
      formatOmpModelsYaml(
        "# Custom providers\nproviders: { mintcat: { baseUrl: https://api.example.test/v1, models: [{ id: gpt-test, name: GPT Test }] } }",
      ),
    ).toBe(`# Custom providers
providers:
  mintcat:
    baseUrl: https://api.example.test/v1
    models:
      - id: gpt-test
        name: GPT Test
`);
  });

  test("saves models.yml atomically after OMP accepts it", async () => {
    const { agentDir, client, runtime } = await createClient();
    runtime.queueModels([]);
    runtime.queueLoginProviders([]);

    const configYaml = "providers:\n  local:\n    auth: none\n";
    await expect(client.saveOmpProviderConfig(configYaml)).resolves.toMatchObject({
      configYaml,
    });
    await expect(readFile(path.join(agentDir, "models.yml"), "utf8")).resolves.toBe(configYaml);
  });
  test("adds an endpoint, API key, and multiple models to native models.yml", async () => {
    const { agentDir, client } = await createClient();

    await client.addOmpProvider({
      providerId: "mintcat",
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-key",
      api: "openai-responses",
      models: [
        {
          id: "gpt-test",
          name: "GPT Test",
          contextWindow: 128_000,
          maxTokens: 16_384,
          supportsImages: true,
        },
        { id: "gpt-test-mini", name: "GPT Test Mini" },
      ],
    });

    const config = parse(await readFile(path.join(agentDir, "models.yml"), "utf8"));
    expect(config).toEqual({
      providers: {
        mintcat: {
          baseUrl: "https://api.example.test/v1",
          apiKey: "test-key",
          api: "openai-responses",
          auth: "apiKey",
          models: [
            {
              id: "gpt-test",
              name: "GPT Test",
              api: "openai-responses",
              input: ["text", "image"],
              contextWindow: 128_000,
              maxTokens: 16_384,
            },
            {
              id: "gpt-test-mini",
              name: "GPT Test Mini",
              api: "openai-responses",
              input: ["text"],
            },
          ],
        },
      },
    });
  });

  test("removes only the requested custom provider", async () => {
    const { agentDir, client } = await createClient();
    const configPath = path.join(agentDir, "models.yml");
    await writeFile(
      configPath,
      `providers:
  mintcat:
    baseUrl: https://mintcat.example.test
    models:
      - id: mint-model
  keep:
    baseUrl: https://keep.example.test
    models:
      - id: keep-model
`,
      "utf8",
    );

    await client.removeOmpProvider("mintcat");

    expect(parse(await readFile(configPath, "utf8"))).toEqual({
      providers: {
        keep: {
          baseUrl: "https://keep.example.test",
          models: [{ id: "keep-model" }],
        },
      },
    });
  });

  test("rolls back a models.yml rejected by OMP", async () => {
    const { agentDir, client, runtime } = await createClient();
    const configPath = path.join(agentDir, "models.yml");
    const previous = "providers: {}\n";
    await writeFile(configPath, previous, "utf8");
    runtime.failNextStart(new Error("invalid models.yml"));

    await expect(client.saveOmpProviderConfig("providers: broken\n")).rejects.toThrow(
      "OMP could not validate the models configuration; the previous configuration was restored. invalid models.yml",
    );
    await expect(readFile(configPath, "utf8")).resolves.toBe(previous);
  });
});

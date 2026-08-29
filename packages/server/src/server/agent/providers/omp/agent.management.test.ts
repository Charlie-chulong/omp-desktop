import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";
import { parse } from "yaml";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import {
  disableStoredOmpProviderCredentials,
  formatOmpModelsYaml,
  readStoredOmpOAuthAccounts,
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
        { id: "anthropic", modelCount: 2, source: "built-in" },
        { id: "openai", modelCount: 1, source: "built-in" },
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
      "OMP rejected models configuration: invalid models.yml",
    );
    await expect(readFile(configPath, "utf8")).resolves.toBe(previous);
  });
});

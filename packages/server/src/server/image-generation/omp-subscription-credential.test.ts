import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DefaultOmpSubscriptionCredentialResolver } from "./omp-subscription-credential.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DefaultOmpSubscriptionCredentialResolver", () => {
  it("maps a persisted credential id to the OMP account position and parses auth claims", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-subscription-credential-"));
    roots.push(root);
    const database = new DatabaseSync(path.join(root, "agent.db"));
    database.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT,
        identity_key TEXT,
        disabled_cause TEXT
      );
      INSERT INTO auth_credentials
        (id, provider, credential_type, data, identity_key, disabled_cause)
      VALUES
        (5, 'anthropic', 'oauth', '{}', NULL, NULL),
        (7, 'openai-codex', 'oauth', '{}', 'email:first@example.com', NULL),
        (9, 'openai-codex', 'oauth', '{}', 'email:second@example.com', NULL);
    `);
    database.close();
    const payload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "account-123",
          chatgpt_plan_type: "Plus",
        },
      }),
    ).toString("base64url");
    const runTokenCommand = vi.fn(async () => `header.${payload}.signature\n`);
    const resolver = new DefaultOmpSubscriptionCredentialResolver({
      env: {
        PI_CODING_AGENT_DIR: root,
        XDG_DATA_HOME: "",
        XDG_STATE_HOME: "",
        XDG_CACHE_HOME: "",
      },
      runTokenCommand,
    });

    await expect(resolver.resolve(9, { forceRefresh: true })).resolves.toEqual({
      accessToken: `header.${payload}.signature`,
      accountId: "account-123",
      planType: "plus",
    });
    expect(runTokenCommand).toHaveBeenCalledWith(2, { forceRefresh: true });
  });

  it("rejects a credential id that is no longer present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-subscription-credential-"));
    roots.push(root);
    const database = new DatabaseSync(path.join(root, "agent.db"));
    database.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT,
        identity_key TEXT,
        disabled_cause TEXT
      );
    `);
    database.close();
    const runTokenCommand = vi.fn();
    const resolver = new DefaultOmpSubscriptionCredentialResolver({
      env: {
        PI_CODING_AGENT_DIR: root,
        XDG_DATA_HOME: "",
        XDG_STATE_HOME: "",
        XDG_CACHE_HOME: "",
      },
      runTokenCommand,
    });

    await expect(resolver.resolve(42)).rejects.toThrow("no longer available");
    expect(runTokenCommand).not.toHaveBeenCalled();
  });
});

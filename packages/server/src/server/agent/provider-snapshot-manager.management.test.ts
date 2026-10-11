import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentClient, OmpProviderManagement } from "./agent-sdk-types.js";
import type { OmpClaudeLimitResets } from "@omp-desktop/protocol/messages";
import { ProviderSnapshotManager } from "./provider-snapshot-manager.js";

const TEST_CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

function createOmpClient(
  getOmpProviderManagement: () => Promise<OmpProviderManagement>,
): AgentClient {
  return {
    provider: "omp",
    capabilities: TEST_CAPABILITIES,
    async createSession() {
      throw new Error("not implemented");
    },
    async resumeSession() {
      throw new Error("not implemented");
    },
    async fetchCatalog() {
      return { models: [], modes: [] };
    },
    async isAvailable() {
      return true;
    },
    getOmpProviderManagement,
  };
}

describe("ProviderSnapshotManager OMP management", () => {
  test("coalesces concurrent reads without caching completed results", async () => {
    const management: OmpProviderManagement = {
      configPath: "/tmp/models.yml",
      configYaml: "providers: {}\n",
      providerModels: [],
      loginProviders: [],
    };
    const pending = Promise.withResolvers<OmpProviderManagement>();
    const getOmpProviderManagement = vi.fn(() => pending.promise);
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        omp: createOmpClient(getOmpProviderManagement),
      },
    });

    try {
      const first = manager.getOmpProviderManagement();
      const second = manager.getOmpProviderManagement();
      expect(getOmpProviderManagement).toHaveBeenCalledOnce();

      pending.resolve(management);
      await expect(Promise.all([first, second])).resolves.toEqual([management, management]);

      await expect(manager.getOmpProviderManagement()).resolves.toBe(management);
      expect(getOmpProviderManagement).toHaveBeenCalledTimes(2);
    } finally {
      manager.destroy();
    }
  });
  test("refreshes reset cards and usage after consumption instead of reusing a pre-consumption read", async () => {
    const stale = Promise.withResolvers<OmpProviderManagement>();
    const before: OmpProviderManagement = {
      configPath: "/tmp/models.yml",
      configYaml: "providers: {}\n",
      providerModels: [],
      loginProviders: [
        {
          id: "openai-codex",
          name: "Codex",
          available: true,
          authenticated: true,
          accounts: [
            {
              credentialId: 1,
              quota: {
                status: "available",
                weeklyUsedPct: 100,
                resetCredits: { status: "available", availableCount: 1, credits: [] },
              },
            },
          ],
        },
      ],
    };
    const after: OmpProviderManagement = {
      ...before,
      loginProviders: [
        {
          ...before.loginProviders[0]!,
          accounts: [
            {
              credentialId: 1,
              quota: {
                status: "available",
                weeklyUsedPct: 0,
                resetCredits: { status: "available", availableCount: 0, credits: [] },
              },
            },
          ],
        },
      ],
    };
    let consumed = false;
    const client = createOmpClient(async () => (consumed ? after : stale.promise));
    client.consumeOmpCodexResetCredit = async () => {
      consumed = true;
      return { code: "reset", windowsReset: 2 };
    };
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { omp: client },
    });
    try {
      const previousRead = manager.getOmpProviderManagement();
      await manager.consumeOmpCodexResetCredit(1, "card", "stable-request");
      expect(await manager.getOmpProviderManagement()).toEqual(after);
      stale.resolve(before);
      expect(await previousRead).toEqual(before);
      expect(await manager.getOmpProviderManagement()).toEqual(after);
    } finally {
      manager.destroy();
    }
  });
  test.each(["confirmed", "unconfirmed"])(
    "detaches pre-mutation Claude reads after a %s outcome without losing the new shared read",
    async (outcome) => {
      const stale = Promise.withResolvers<OmpProviderManagement>();
      const fresh = Promise.withResolvers<OmpProviderManagement>();
      const inventory: OmpClaudeLimitResets = {
        status: "available",
        eligible: true,
        availableCount: 2,
        grants: [],
        nextGrantId: null,
        atLimit: true,
        exhausted: ["five_hour"],
        cooldownUntil: null,
        ineligibleReason: null,
      };
      const before: OmpProviderManagement = {
        configPath: "/tmp/models.yml",
        configYaml: "providers: {}\n",
        providerModels: [],
        loginProviders: [
          {
            id: "anthropic",
            name: "Claude",
            available: true,
            authenticated: true,
            accounts: [
              {
                credentialId: 1,
                quota: {
                  status: "available",
                  fiveHourUsedPct: 100,
                  limitResets: inventory,
                },
              },
            ],
          },
        ],
      };
      const after: OmpProviderManagement = {
        ...before,
        loginProviders: [
          {
            id: "anthropic",
            name: "Claude",
            available: true,
            authenticated: true,
            accounts: [
              {
                credentialId: 1,
                quota: {
                  status: "available",
                  fiveHourUsedPct: 0,
                  limitResets: {
                    ...inventory,
                    availableCount: 1,
                    atLimit: false,
                    exhausted: [],
                  },
                },
              },
            ],
          },
        ],
      };
      const getManagement = vi
        .fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(() => fresh.promise);
      const client = createOmpClient(getManagement);
      client.consumeOmpClaudeLimitReset = async () => {
        if (outcome === "unconfirmed") throw new Error("redemption is unconfirmed");
        return {
          result: "reset",
          reason: null,
          resetsLeft: 1,
          cleared: ["five_hour"],
          weeklyResetsAt: null,
          cooldownUntil: null,
        };
      };
      const manager = new ProviderSnapshotManager({
        logger: createTestLogger(),
        extraClients: { omp: client },
      });
      try {
        const previousRead = manager.getOmpProviderManagement();
        const mutation = manager.consumeOmpClaudeLimitReset(1, "grant", "stable-request");
        if (outcome === "unconfirmed") await expect(mutation).rejects.toThrow("unconfirmed");
        else await expect(mutation).resolves.toMatchObject({ result: "reset" });
        const refresh = manager.getOmpProviderManagement();
        expect(getManagement).toHaveBeenCalledTimes(2);
        stale.resolve(before);
        expect(await previousRead).toEqual(before);
        const concurrentRefresh = manager.getOmpProviderManagement();
        expect(getManagement).toHaveBeenCalledTimes(2);
        fresh.resolve(after);
        await expect(Promise.all([refresh, concurrentRefresh])).resolves.toEqual([after, after]);
      } finally {
        manager.destroy();
      }
    },
  );
});

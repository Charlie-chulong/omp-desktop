import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type {
  AgentClient,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  FetchCatalogOptions,
  ProviderRefreshContext,
} from "./agent-sdk-types.js";
import {
  GLOBAL_PROVIDER_SNAPSHOT_KEY,
  ProviderSnapshotManager,
} from "./provider-snapshot-manager.js";

const TEST_CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;
const TEST_REFRESH_TIMEOUT_MS = 120_000;

// Builds an AgentClient that can be injected via the public extraClients option.
// extraClients is the only injection surface the manager exposes for tests.
function createExtraClient(
  provider: AgentProvider,
  overrides: Partial<AgentClient> = {},
): AgentClient {
  return {
    provider,
    capabilities: TEST_CAPABILITIES,
    async createSession() {
      throw new Error("not implemented");
    },
    async resumeSession() {
      throw new Error("not implemented");
    },
    async fetchCatalog(_options: FetchCatalogOptions) {
      return { models: [] as AgentModelDefinition[], modes: [] as AgentMode[] };
    },
    async isAvailable() {
      return false;
    },
    ...overrides,
  } satisfies AgentClient;
}

function waitUntilAborted(signal?: AbortSignal): Promise<boolean> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((finish) => setTimeout(finish, delayMs));
}

function waitForAbortWithCleanup(
  signal: AbortSignal,
  cleanupState: { cleanedUp: boolean },
): Promise<void> {
  return new Promise((_resolve, reject) => {
    const handleAbort = () => {
      cleanupState.cleanedUp = true;
      reject(signal.reason);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function runTestCatalogActivities(
  context: ProviderRefreshContext,
  cleanupState: { cleanedUp: boolean },
): Promise<void> {
  const waitForAgents = () => waitForDelay(50);
  const waitForProviders = () => waitForAbortWithCleanup(context.signal, cleanupState);
  await Promise.all([
    context.runActivity("app.agents", waitForAgents),
    context.runActivity("provider.list", waitForProviders),
  ]);
}

describe("ProviderSnapshotManager public surface", () => {
  test("reports an unavailable Hub agent provider at the authored provider field", async () => {
    const manager = new ProviderSnapshotManager({ logger: createTestLogger() });
    try {
      await expect(
        manager.validateAgentConfiguration({ provider: "not-installed" }),
      ).resolves.toEqual([
        { path: ["provider"], message: "Provider 'not-installed' is not configured" },
      ]);
    } finally {
      manager.destroy();
    }
  });

  test("providerOverrides with enabled:false marks the provider as unavailable without probing", async () => {
    const isAvailable = vi.fn(async () => true);
    const fetchCatalog = vi.fn(async () => ({
      models: [] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        codex: { enabled: false },
        pi: { enabled: false },
      },
      extraClients: {
        codex: createExtraClient("codex", { isAvailable, fetchCatalog }),
      },
    });
    try {
      const codex = await manager.getProvider({ provider: "codex", wait: true });
      expect(codex).toMatchObject({ provider: "codex", enabled: false, status: "unavailable" });
      expect(isAvailable).not.toHaveBeenCalled();
      expect(fetchCatalog).not.toHaveBeenCalled();
    } finally {
      manager.destroy();
    }
  });

  test("extraClients with isAvailable=false routes to unavailable without fetching", async () => {
    const isAvailable = vi.fn().mockResolvedValue(false);
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
      extraClients: { codex: createExtraClient("codex", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({ provider: "codex", wait: true });
      expect(entry.provider).toBe("codex");
      expect(entry.status).toBe("unavailable");
      expect(isAvailable).toHaveBeenCalledTimes(1);
    } finally {
      manager.destroy();
    }
  });

  test("wait:true returns a warm provider without refreshing it", async () => {
    const isAvailable = vi.fn(async () => true);
    const fetchCatalog = vi.fn(async () => ({
      models: [
        {
          provider: "codex",
          id: "gpt-5.4-mini",
          label: "GPT 5.4 Mini",
        },
      ] as AgentModelDefinition[],
      modes: [] as AgentMode[],
    }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        codex: createExtraClient("codex", { isAvailable, fetchCatalog }),
      },
    });
    const listener = vi.fn();
    manager.on("change", listener);
    try {
      const [first] = await manager.listProviders({ providers: ["codex"], wait: true });
      expect(first).toMatchObject({ provider: "codex", status: "ready" });
      expect(isAvailable).toHaveBeenCalledTimes(1);
      expect(fetchCatalog).toHaveBeenCalledTimes(1);

      listener.mockClear();
      const [second] = await manager.listProviders({ providers: ["codex"], wait: true });

      expect(second).toEqual(first);
      expect(isAvailable).toHaveBeenCalledTimes(1);
      expect(fetchCatalog).toHaveBeenCalledTimes(1);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      manager.destroy();
    }
  });

  test("ready snapshots publish the catalog's capability-aware default mode", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: async () => true,
          fetchCatalog: async () => ({
            models: [],
            modes: [{ id: "default", label: "Default", description: "Ask before running tools" }],
            defaultModeId: "default",
          }),
        }),
      },
    });

    try {
      const entry = await manager.getProvider({ provider: "codex", wait: true });

      expect(entry).toMatchObject({ status: "ready", defaultModeId: "default" });
    } finally {
      manager.destroy();
    }
  });

  test("refreshTimeoutMs option overrides the default and yields a timeout error", async () => {
    // never-resolving isAvailable forces the timeout path
    const isAvailable = vi.fn(waitUntilAborted);
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 1,
      providerOverrides: {
        pi: { enabled: false },
      },
      extraClients: { codex: createExtraClient("codex", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({ provider: "codex", wait: true });
      expect(entry.provider).toBe("codex");
      expect(entry.status).toBe("error");
      expect(entry.error).toMatch(/after 1ms/);
    } finally {
      manager.destroy();
    }
  });

  test("setRefreshTimeoutMs changes the deadline for future refreshes", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 60_000,
      providerOverrides: {
        pi: { enabled: false },
      },
      extraClients: {
        codex: createExtraClient("codex", { isAvailable: vi.fn(waitUntilAborted) }),
      },
    });
    manager.setRefreshTimeoutMs(1);

    try {
      await expect(manager.getProvider({ provider: "codex", wait: true })).resolves.toMatchObject({
        status: "error",
        error: "Timed out refreshing Codex after 1ms; pending: availability",
      });
    } finally {
      manager.destroy();
    }
  });

  test("defaults provider refreshes to a two-minute deadline", async () => {
    vi.useFakeTimers();
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
      extraClients: {
        codex: createExtraClient("codex", { isAvailable: waitUntilAborted }),
      },
    });

    try {
      const entryPromise = manager.getProvider({ provider: "codex", wait: true });

      await vi.advanceTimersByTimeAsync(120_000);

      await expect(entryPromise).resolves.toMatchObject({
        status: "error",
        error: "Timed out refreshing Codex after 120000ms; pending: availability",
      });
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("one refresh timeout covers availability and catalog discovery", async () => {
    vi.useFakeTimers();
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 100,
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: () =>
            new Promise((settle) => {
              setTimeout(() => settle(true), 60);
            }),
          fetchCatalog: () =>
            new Promise((settle) => {
              setTimeout(() => settle({ models: [], modes: [] }), 60);
            }),
        }),
      },
    });

    try {
      const entryPromise = manager.getProvider({ provider: "codex", wait: true });

      await vi.advanceTimersByTimeAsync(120);

      await expect(entryPromise).resolves.toMatchObject({
        provider: "codex",
        status: "error",
        error: "Timed out refreshing Codex after 100ms",
      });
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("timeout names pending catalog activities, aborts them, and waits for cleanup", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const cleanupState = { cleanedUp: false };
    const fetchCatalog = vi.fn(
      async (_options: FetchCatalogOptions, context?: ProviderRefreshContext) => {
        attempt += 1;
        if (attempt > 1) {
          expect(cleanupState.cleanedUp).toBe(true);
          return { models: [], modes: [] };
        }

        if (!context) throw new Error("missing refresh context");
        await runTestCatalogActivities(context, cleanupState);
        return { models: [], modes: [] };
      },
    );
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 100,
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: async () => true,
          fetchCatalog,
        }),
      },
    });

    try {
      const first = manager.getProvider({ provider: "codex", wait: true });
      await vi.advanceTimersByTimeAsync(100);
      await expect(first).resolves.toMatchObject({
        status: "error",
        error: "Timed out refreshing Codex after 100ms; pending: provider.list",
      });
      expect(cleanupState.cleanedUp).toBe(true);

      await manager.refreshSettingsSnapshot({ providers: ["codex"] });
      expect(fetchCatalog).toHaveBeenCalledTimes(2);
      expect(manager.getSnapshot().find((entry) => entry.provider === "codex")).toMatchObject({
        provider: "codex",
        status: "ready",
      });
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("each provider refresh gets its own timeout", async () => {
    vi.useFakeTimers();
    const neverReturnsCatalog = (_options: FetchCatalogOptions, context?: ProviderRefreshContext) =>
      new Promise<never>((_resolve, reject) => {
        context?.signal.addEventListener("abort", () => reject(context.signal.reason), {
          once: true,
        });
      });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 100,
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: async () => true,
          fetchCatalog: neverReturnsCatalog,
        }),
        pi: createExtraClient("pi", {
          isAvailable: async () => true,
          fetchCatalog: neverReturnsCatalog,
        }),
      },
    });

    try {
      const codexPromise = manager.getProvider({ provider: "codex", wait: true });
      await vi.advanceTimersByTimeAsync(50);

      const piPromise = manager.getProvider({ provider: "pi", wait: true });
      await vi.advanceTimersByTimeAsync(50);

      await expect(codexPromise).resolves.toMatchObject({
        provider: "codex",
        status: "error",
      });
      await expect(manager.getProvider({ provider: "pi", wait: false })).resolves.toMatchObject({
        provider: "pi",
        status: "loading",
      });

      await vi.advanceTimersByTimeAsync(50);

      await expect(piPromise).resolves.toMatchObject({
        provider: "pi",
        status: "error",
      });
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("PASEO_PROVIDER_REFRESH_TIMEOUT_MS env var is honored when no option is given", async () => {
    vi.stubEnv("PASEO_PROVIDER_REFRESH_TIMEOUT_MS", "1");
    const isAvailable = vi.fn(waitUntilAborted);
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        pi: { enabled: false },
      },
      extraClients: { codex: createExtraClient("codex", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({ provider: "codex", wait: true });
      expect(entry.status).toBe("error");
      expect(entry.error).toMatch(/after 1ms/);
    } finally {
      manager.destroy();
      vi.unstubAllEnvs();
    }
  });

  test("PASEO_PROVIDER_REFRESH_TIMEOUT_MS env var is ignored when option is provided", async () => {
    vi.stubEnv("PASEO_PROVIDER_REFRESH_TIMEOUT_MS", "1");
    const isAvailable = vi.fn(waitUntilAborted);
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: 5,
      providerOverrides: {
        pi: { enabled: false },
      },
      extraClients: { codex: createExtraClient("codex", { isAvailable }) },
    });
    try {
      const entry = await manager.getProvider({ provider: "codex", wait: true });
      expect(entry.status).toBe("error");
      // explicit option (5) wins over env var (1)
      expect(entry.error).toMatch(/after 5ms/);
    } finally {
      manager.destroy();
      vi.unstubAllEnvs();
    }
  });

  test("getProvider throws when the provider is not configured", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: false } },
    });
    try {
      await expect(
        manager.getProvider({ provider: "not-a-provider" as AgentProvider, wait: true }),
      ).rejects.toThrow(/not configured/);
    } finally {
      manager.destroy();
    }
  });

  test("listModels rejects when the provider is disabled", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: false } },
    });
    try {
      await expect(manager.listModels({ provider: "codex", wait: true })).rejects.toThrow(
        /disabled/,
      );
    } finally {
      manager.destroy();
    }
  });

  test("listModels excludes compatibility-only catalog entries", async () => {
    const client = createExtraClient("codex", {
      isAvailable: async () => true,
      fetchCatalog: async () => ({
        models: [
          { provider: "codex", id: "gpt-5.4", label: "GPT 5.4" },
          {
            provider: "codex",
            id: "gpt-5.4-legacy",
            label: "GPT 5.4 legacy",
            isSelectable: false,
          },
        ],
        modes: [],
      }),
    });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { codex: client },
    });
    try {
      const models = await manager.listModels({ provider: "codex", wait: true });
      expect(models.map((model) => model.id)).toEqual(["gpt-5.4"]);
    } finally {
      manager.destroy();
    }
  });

  test("listModes rejects when the provider is disabled", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: false } },
    });
    try {
      await expect(manager.listModes({ provider: "codex", wait: true })).rejects.toThrow(
        /disabled/,
      );
    } finally {
      manager.destroy();
    }
  });

  test("resolveDefaultModel returns the requested model verbatim when provided", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: false } },
    });
    try {
      const id = await manager.resolveDefaultModel({
        provider: "codex",
        requestedModel: "gpt-5.4",
      });
      expect(id).toBe("gpt-5.4");
    } finally {
      manager.destroy();
    }
  });

  test("resolveDefaultModel returns undefined when the provider is disabled and no override is given", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: false } },
    });
    try {
      const id = await manager.resolveDefaultModel({ provider: "codex" });
      expect(id).toBeUndefined();
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic returns the diagnostic from the injected client and appends snapshot models/status", async () => {
    const getDiagnostic = vi.fn(async () => ({ diagnostic: "codex is ready" }));
    const client = createExtraClient("codex", { getDiagnostic });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { codex: client },
    });
    try {
      const result = await manager.getProviderDiagnostic("codex");
      expect(result.provider).toBe("codex");
      expect(result.diagnostic).toContain("codex is ready");
      expect(result.diagnostic).toContain("Models:");
      expect(result.diagnostic).toContain("Status:");
      expect(getDiagnostic).toHaveBeenCalledTimes(1);
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic force-refreshes the snapshot and appends models/status", async () => {
    const catalogModels: AgentModelDefinition[] = [
      { provider: "codex", id: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
    ];
    const catalogModes: AgentMode[] = [{ id: "agent", label: "Agent" }];
    const fetchCatalog = vi.fn(async () => ({
      models: catalogModels,
      modes: catalogModes,
    }));
    const client = createExtraClient("codex", {
      isAvailable: async () => true,
      fetchCatalog,
    });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { codex: client },
    });
    try {
      const result = await manager.getProviderDiagnostic("codex");
      expect(fetchCatalog).toHaveBeenCalledTimes(1);
      expect(fetchCatalog.mock.calls[0]?.[0]).toMatchObject({ scope: "global", force: true });
      expect(result.diagnostic).toContain("Models: 1");
      expect(result.diagnostic).toContain("Status: Ready");
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic falls back to a default message when the client has no getDiagnostic and appends snapshot models/status", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: { codex: createExtraClient("codex") },
    });
    try {
      const result = await manager.getProviderDiagnostic("codex");
      expect(result.provider).toBe("codex");
      expect(result.diagnostic).toMatch(/no diagnostic/i);
      expect(result.diagnostic).toContain("Models:");
      expect(result.diagnostic).toContain("Status:");
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic turns provider diagnostic failures into diagnostic text", async () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: async () => true,
          fetchCatalog: async () => ({
            models: [{ provider: "codex", id: "gpt-5.4-mini", label: "GPT 5.4 Mini" }],
            modes: [] as AgentMode[],
          }),
          getDiagnostic: async () => {
            throw new Error("diagnostic probe exploded");
          },
        }),
      },
    });
    try {
      const result = await manager.getProviderDiagnostic("codex");
      expect(result.diagnostic).toContain("Error: diagnostic probe exploded");
      expect(result.diagnostic).toContain("Models: 1");
      expect(result.diagnostic).toContain("Status: Ready");
    } finally {
      manager.destroy();
    }
  });

  test("getProviderDiagnostic starts provider diagnostics before waiting for snapshot refresh", async () => {
    vi.useFakeTimers();
    let diagnosticStarted = false;
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: TEST_REFRESH_TIMEOUT_MS,
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: async () => true,
          fetchCatalog: async (_options, context) => {
            await context?.runActivity("model/list", () => waitUntilAborted(context.signal));
            return { models: [], modes: [] };
          },
          getDiagnostic: async () => {
            diagnosticStarted = true;
            return { diagnostic: "codex diagnostics available" };
          },
        }),
      },
    });
    try {
      const diagnosticRequest = manager.getProviderDiagnostic("codex");
      expect(diagnosticStarted).toBe(true);

      const diagnosticOrBlocked = Promise.race([
        diagnosticRequest.then(() => ({ type: "diagnostic" as const })),
        new Promise<{ type: "blocked" }>((finish) => {
          setTimeout(() => finish({ type: "blocked" }), 1);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(1);
      await expect(diagnosticOrBlocked).resolves.toEqual({ type: "blocked" });

      await vi.advanceTimersByTimeAsync(TEST_REFRESH_TIMEOUT_MS - 1);
      const result = await diagnosticRequest;
      expect(result.diagnostic).toContain("codex diagnostics available");
      expect(result.diagnostic).toContain(
        `Status: Error: Timed out refreshing Codex after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("getProviderDiagnostic starts snapshot refresh even when provider diagnostics hang", async () => {
    vi.useFakeTimers();
    let diagnosticStarted = false;
    let snapshotStarted = false;
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: TEST_REFRESH_TIMEOUT_MS,
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: async () => true,
          fetchCatalog: async (_options, context) => {
            snapshotStarted = true;
            await context?.runActivity("model/list", () => waitUntilAborted(context.signal));
            return { models: [], modes: [] };
          },
          getDiagnostic: async () => {
            diagnosticStarted = true;
            return new Promise(() => {});
          },
        }),
      },
    });
    try {
      const diagnosticRequest = manager.getProviderDiagnostic("codex");
      await vi.advanceTimersByTimeAsync(0);

      expect(diagnosticStarted).toBe(true);
      expect(snapshotStarted).toBe(true);

      await vi.advanceTimersByTimeAsync(TEST_REFRESH_TIMEOUT_MS);
      const result = await diagnosticRequest;
      expect(result.diagnostic).toContain(
        `Error: Timed out collecting Codex diagnostic after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
      expect(result.diagnostic).toContain(
        `Status: Error: Timed out refreshing Codex after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("getProviderDiagnostic reports provider diagnostic timeout while preserving snapshot details", async () => {
    vi.useFakeTimers();
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      refreshTimeoutMs: TEST_REFRESH_TIMEOUT_MS,
      extraClients: {
        codex: createExtraClient("codex", {
          isAvailable: async () => true,
          fetchCatalog: async () => ({
            models: [{ provider: "codex", id: "gpt-5.4-mini", label: "GPT 5.4 Mini" }],
            modes: [] as AgentMode[],
          }),
          getDiagnostic: async () => new Promise(() => {}),
        }),
      },
    });
    try {
      const diagnosticRequest = manager.getProviderDiagnostic("codex");
      await vi.advanceTimersByTimeAsync(TEST_REFRESH_TIMEOUT_MS);

      const result = await diagnosticRequest;
      expect(result.diagnostic).toContain(
        `Error: Timed out collecting Codex diagnostic after ${TEST_REFRESH_TIMEOUT_MS}ms`,
      );
      expect(result.diagnostic).toContain("Models: 1");
      expect(result.diagnostic).toContain("Status: Ready");
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });

  test("getProviderDiagnostic returns an error diagnostic for an unknown provider", async () => {
    const manager = new ProviderSnapshotManager({ logger: createTestLogger() });
    try {
      await expect(manager.getProviderDiagnostic("unknown-provider" as AgentProvider)).resolves
        .toMatchInlineSnapshot(`
          {
            "diagnostic": "unknown-provider
            Error: Provider unknown-provider is not configured",
            "provider": "unknown-provider",
          }
        `);
    } finally {
      manager.destroy();
    }
  });
});

describe("ProviderSnapshotManager applyMutableProviderConfig", () => {
  test("stages provider state without events, then publishes or rolls back", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        codex: { enabled: true },
        pi: { enabled: false },
      },
    });
    try {
      manager.getSnapshot();
      const events: string[] = [];
      manager.on("change", (_entries, changedCwd) => events.push(changedCwd));

      const rolledBack = manager.stageMutableProviderConfig(
        { codex: { enabled: false } },
        { replace: true },
      );
      expect(events).toEqual([]);
      expect(manager.getAgentManagerProviderState().providerDefinitions.codex).toMatchObject({
        enabled: false,
      });
      rolledBack.rollback();
      expect(events).toEqual([]);
      expect(manager.getAgentManagerProviderState().providerDefinitions.codex).toMatchObject({
        enabled: true,
      });

      const committed = manager.stageMutableProviderConfig(
        { codex: { enabled: false } },
        { replace: true },
      );
      expect(events).toEqual([]);
      committed.publish();
      expect(events).toEqual([GLOBAL_PROVIDER_SNAPSHOT_KEY]);
    } finally {
      manager.destroy();
    }
  });

  test("restores provider state when applying a live config fails", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        codex: { enabled: true },
        pi: { enabled: false },
      },
    });
    manager.getSnapshot();
    manager.on("change", () => {
      throw new Error("snapshot consumer failed");
    });

    try {
      expect(() =>
        manager.applyMutableProviderConfig({ codex: { enabled: false } }, { replace: true }),
      ).toThrow("snapshot consumer failed");
      expect(manager.getAgentManagerProviderState().providerDefinitions.codex).toMatchObject({
        enabled: true,
      });
    } finally {
      manager.destroy();
    }
  });
});

describe("ProviderSnapshotManager lifecycle", () => {
  test("owns every materialized client generation until daemon shutdown", async () => {
    const providerConfig = (label: string) => ({
      codex: { enabled: true, label },
      omp: { enabled: false },
      pi: { enabled: false },
    });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: providerConfig("Initial"),
    });
    const shutdowns: Array<ReturnType<typeof vi.fn>> = [];
    const trackShutdown = (client: AgentClient | undefined): AgentClient => {
      if (!client) throw new Error("Expected materialized Codex client");
      const shutdown = vi.fn(async () => undefined);
      client.shutdown = shutdown;
      shutdowns.push(shutdown);
      return client;
    };

    const initialClient = trackShutdown(manager.getAgentManagerProviderState().clients.codex);
    const published = manager.stageMutableProviderConfig(providerConfig("Published"), {
      replace: true,
    });
    const publishedClient = trackShutdown(published.agentManagerState.clients.codex);
    published.publish();

    const rolledBack = manager.stageMutableProviderConfig(providerConfig("Rolled back"), {
      replace: true,
    });
    trackShutdown(rolledBack.agentManagerState.clients.codex);
    rolledBack.rollback();

    expect(manager.getAgentManagerProviderState().clients.codex).toBe(publishedClient);

    const newest = manager.stageMutableProviderConfig(providerConfig("Newest"), { replace: true });
    const newestClient = trackShutdown(newest.agentManagerState.clients.codex);
    newest.publish();

    expect(initialClient).not.toBe(publishedClient);
    expect(manager.getAgentManagerProviderState().clients.codex).toBe(newestClient);
    for (const shutdown of shutdowns) expect(shutdown).not.toHaveBeenCalled();

    await manager.shutdown();

    for (const shutdown of shutdowns) expect(shutdown).toHaveBeenCalledTimes(1);
    manager.destroy();
  });

  test("on/off attaches and detaches change listeners", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        codex: { enabled: false },
        pi: { enabled: false },
      },
    });
    try {
      const listener = vi.fn();
      manager.on("change", listener);
      manager.getSnapshot();
      manager.applyMutableProviderConfig({});
      const firstCallCount = listener.mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      manager.off("change", listener);
      manager.applyMutableProviderConfig({});
      expect(listener.mock.calls.length).toBe(firstCallCount);
    } finally {
      manager.destroy();
    }
  });

  test("destroy clears snapshots and prevents further change emissions", () => {
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: {
        codex: { enabled: false },
        pi: { enabled: false },
      },
    });
    const listener = vi.fn();
    manager.on("change", listener);
    manager.getSnapshot();
    manager.destroy();

    listener.mockClear();
    manager.applyMutableProviderConfig({});
    expect(listener).not.toHaveBeenCalled();
  });
});

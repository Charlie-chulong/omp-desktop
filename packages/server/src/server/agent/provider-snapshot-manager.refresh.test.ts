import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentClient, ProviderCatalog, ProviderSnapshotEntry } from "./agent-sdk-types.js";
import {
  GLOBAL_PROVIDER_SNAPSHOT_KEY,
  ProviderSnapshotManager,
} from "./provider-snapshot-manager.js";

function createCatalogClient(
  provider: string,
  fetchCatalog: AgentClient["fetchCatalog"],
): AgentClient {
  return {
    provider,
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: false,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    async createSession() {
      throw new Error("Catalog tests do not create sessions");
    },
    async resumeSession() {
      throw new Error("Catalog tests do not resume sessions");
    },
    async isAvailable() {
      return true;
    },
    fetchCatalog,
  };
}

function catalog(modelId: string, provider = "omp"): ProviderCatalog {
  return { models: [{ provider, id: modelId, label: modelId }], modes: [] };
}

function observeSnapshots(manager: ProviderSnapshotManager) {
  const updates = new Map<string, ProviderSnapshotEntry[][]>();
  manager.on("change", (entries, cwd) => {
    const history = updates.get(cwd) ?? [];
    history.push(entries);
    updates.set(cwd, history);
  });
  return updates;
}

describe("ProviderSnapshotManager settings refresh", () => {
  test("publishes refreshed global models while retaining unrefreshed providers", async () => {
    let revision = 1;
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: false } },
      extraClients: {
        omp: createCatalogClient("omp", async () => catalog(`global:${revision}`)),
        pi: createCatalogClient("pi", async () => catalog(`import:${revision}`, "pi")),
      },
    });
    const updates = observeSnapshots(manager);

    try {
      await manager.warmUpSnapshot({ providers: ["omp", "pi"] });
      updates.clear();
      revision = 2;

      await manager.refreshSettingsSnapshot({ providers: ["omp"] });

      const history = updates.get(GLOBAL_PROVIDER_SNAPSHOT_KEY) ?? [];
      expect(history[0]?.find((entry) => entry.provider === "omp")?.status).toBe("loading");
      const latest = history.at(-1);
      expect(latest?.find((entry) => entry.provider === "omp")).toMatchObject({
        status: "ready",
        models: [{ id: "global:2" }],
      });
      expect(latest?.find((entry) => entry.provider === "pi")).toMatchObject({
        status: "ready",
        models: [{ id: "import:1" }],
      });
    } finally {
      manager.destroy();
    }
  });

  test("publishes a catalog failure without leaving the provider loading", async () => {
    let failCatalog = false;
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { pi: { enabled: false }, codex: { enabled: false } },
      extraClients: {
        omp: createCatalogClient("omp", async () => {
          if (failCatalog) throw new Error("Global catalog unavailable");
          return catalog("original-model");
        }),
      },
    });
    const updates = observeSnapshots(manager);

    try {
      await manager.warmUpSnapshot({ providers: ["omp"] });
      updates.clear();
      failCatalog = true;

      await manager.refreshSettingsSnapshot({ providers: ["omp"] });

      expect(
        updates
          .get(GLOBAL_PROVIDER_SNAPSHOT_KEY)
          ?.at(-1)
          ?.find((entry) => entry.provider === "omp"),
      ).toMatchObject({
        status: "error",
        error: "Global catalog unavailable",
      });
    } finally {
      manager.destroy();
    }
  });

  test("replaces an in-flight load and ignores its late catalog", async () => {
    const started = Promise.withResolvers<void>();
    const oldCatalog = Promise.withResolvers<ProviderCatalog>();
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { pi: { enabled: false }, codex: { enabled: false } },
      extraClients: {
        omp: createCatalogClient("omp", async (options) => {
          if (!options.force) {
            started.resolve();
            return oldCatalog.promise;
          }
          return catalog("updated-model");
        }),
      },
    });
    const updates = observeSnapshots(manager);
    const initialLoad = manager.warmUpSnapshot({ providers: ["omp"] });

    try {
      await started.promise;
      updates.clear();

      await manager.refreshSettingsSnapshot({ providers: ["omp"] });

      expect(
        updates
          .get(GLOBAL_PROVIDER_SNAPSHOT_KEY)
          ?.at(-1)
          ?.find((entry) => entry.provider === "omp"),
      ).toMatchObject({
        status: "ready",
        models: [{ id: "updated-model" }],
      });
      oldCatalog.resolve(catalog("obsolete-model"));
      await initialLoad;
      expect(manager.getSnapshot().find((entry) => entry.provider === "omp")).toMatchObject({
        status: "ready",
        models: [{ id: "updated-model" }],
      });
    } finally {
      oldCatalog.resolve(catalog("obsolete-model"));
      await initialLoad;
      manager.destroy();
    }
  });
});

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import type { OmpStatsSnapshot } from "@omp-desktop/protocol/omp-stats";
import { HostUsagePage } from "./host-usage-page";

type UsageClient = Pick<
  DaemonClient,
  "getOmpProviderManagement" | "listProviderUsage" | "consumeOmpCodexResetCredit" | "getOmpStats"
>;

const nativeStats: OmpStatsSnapshot = {
  status: "available",
  source: "omp_stats_db",
  range: "24h",
  fetchedAt: "2026-10-18T00:00:00.000Z",
  scope: { kind: "host_profile", profile: "default" },
  indexedThrough: 1_792_300_000_000,
  overall: {
    totalRequests: 4,
    failedRequests: 0,
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalTokens: 30,
    totalCostUsd: 1.5,
    unpricedRequests: 0,
    transcriptCount: 1,
    firstTimestamp: 1_792_300_000_000,
    lastTimestamp: 1_792_300_000_000,
  },
  byModel: [],
  byProvider: [],
  byAgentType: [],
};

const runtime = vi.hoisted(() => ({
  client: null as UsageClient | null,
  confirm: vi.fn(async () => false),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "server-1", label: "Test host" }],
  useHostRuntimeClient: () => runtime.client,
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-1": {
          client: runtime.client,
          serverInfo: {
            features: {
              providerUsageList: true,
              ompStats: true,
              ompProviderManagement: true,
              ompCodexResetCredits: true,
              ompClaudeLimitResets: true,
            },
          },
        },
      },
    }),
}));
vi.mock("@/hooks/use-omp-provider-account-notes", () => ({
  useOmpProviderAccountNotes: () => ({ notes: {}, loading: false }),
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: runtime.confirm }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { balance?: string }) =>
      key === "settings.providers.omp.codexQuota.creditsBalance"
        ? `Remaining: ${options?.balance} credits`
        : key,
    i18n: { language: "en" },
  }),
}));

let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  runtime.client = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("shows account quota and its reset card together in Usage", async () => {
  const consume = vi.fn();
  runtime.client = {
    getOmpProviderManagement: async () => ({
      requestId: "management",
      configPath: "/tmp/models.yml",
      configYaml: "",
      providerModels: [],
      loginProviders: [
        {
          id: "openai-codex",
          name: "OpenAI Codex",
          available: true,
          authenticated: true,
          accounts: [
            {
              credentialId: 42,
              quota: {
                status: "available",
                weeklyUsedPct: 80,
                credits: {
                  hasCredits: true,
                  unlimited: false,
                  balance: "9007199254740993.000001",
                },
                resetCredits: {
                  status: "available",
                  availableCount: 1,
                  credits: [
                    {
                      id: "card-1",
                      status: "available",
                      resetType: "codex_rate_limits",
                      grantedAt: "2026-01-01T00:00:00Z",
                      expiresAt: null,
                      title: "Full reset",
                      description: null,
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    }),
    listProviderUsage: async () => ({
      requestId: "usage",
      fetchedAt: "2026-10-18T00:00:00Z",
      providers: [],
    }),
    consumeOmpCodexResetCredit: consume,
    getOmpStats: async () => ({ requestId: "native-stats", stats: nativeStats }),
  };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HostUsagePage serverId="server-1" />
    </QueryClientProvider>,
  );

  const card = await screen.findByTestId("omp-reset-credit-consume-42-card-1");
  expect(screen.getByText("agentControls.quota.weekly")).toBeTruthy();
  expect(screen.getAllByText("Remaining: 9007199254740993.000001 credits")).toHaveLength(1);
  await screen.findByTestId("omp-native-stats-summary");
  expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("4");
  expect(screen.getByTestId("omp-native-stats-cost").textContent).toBe("$1.50");
  fireEvent.click(card);
  await waitFor(() => expect(runtime.confirm).toHaveBeenCalledOnce());
  expect(consume).not.toHaveBeenCalled();
});

it("shows Claude limits and reset controls in Usage", async () => {
  runtime.client = {
    getOmpProviderManagement: async () => ({
      requestId: "management",
      configPath: "/tmp/models.yml",
      configYaml: "",
      providerModels: [],
      loginProviders: [
        {
          id: "anthropic",
          name: "Claude",
          available: true,
          authenticated: true,
          accounts: [
            {
              credentialId: 7,
              quota: {
                status: "available",
                weeklyUsedPct: 60,
                modelWindows: [{ model: "opus", usedPct: 25, resetsAt: null }],
              },
            },
          ],
        },
      ],
    }),
    listProviderUsage: async () => ({
      requestId: "usage",
      fetchedAt: "2026-10-18T00:00:00Z",
      providers: [],
    }),
    consumeOmpCodexResetCredit: vi.fn(),
    getOmpStats: async () => ({ requestId: "native-stats", stats: nativeStats }),
  };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HostUsagePage serverId="server-1" />
    </QueryClientProvider>,
  );

  await screen.findByTestId("omp-claude-limit-resets-7");
  expect(screen.getByText("providerUsage.modelWeekly")).toBeTruthy();
  expect(screen.getByText("settings.providers.omp.claudeLimitResets.refresh")).toBeTruthy();
});

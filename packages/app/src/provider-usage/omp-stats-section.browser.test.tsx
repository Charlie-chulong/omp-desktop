import React from "react";
import { createInstance } from "i18next";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import type {
  OmpStatsGetResponseMessage,
  OmpStatsRange,
  OmpStatsSnapshot,
} from "@omp-desktop/protocol/omp-stats";
import { providerUsage } from "@/i18n/resources/provider-usage";
import { OmpStatsSettingsSection } from "./omp-stats-section";

type StatsPayload = OmpStatsGetResponseMessage["payload"];
const runtime = vi.hoisted(() => ({
  clients: {} as Record<string, Pick<DaemonClient, "getOmpStats">>,
  connected: true,
  supported: true,
  t: (key: string, _options?: Record<string, unknown>): string => key,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: (serverId: string) => runtime.clients[serverId] ?? null,
  useHostRuntimeIsConnected: () => runtime.connected,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        first: { serverInfo: { features: { ompStats: runtime.supported } } },
        second: { serverInfo: { features: { ompStats: runtime.supported } } },
      },
    }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: runtime.t, i18n: { language: "zh-CN" } }),
}));

let queryClient: QueryClient;

function snapshot(requests = 2, range: OmpStatsRange = "24h"): OmpStatsSnapshot {
  const metrics = {
    totalRequests: requests,
    failedRequests: requests === 0 ? 0 : 1,
    totalInputTokens: requests * 10,
    totalOutputTokens: requests * 20,
    totalCacheReadTokens: requests * 30,
    totalCacheWriteTokens: requests * 40,
    totalTokens: requests * 123,
    totalCostUsd: requests * 1.25,
    unpricedRequests: 0,
    transcriptCount: requests === 0 ? 0 : 1,
    firstTimestamp: requests === 0 ? null : 1_792_300_000_000,
    lastTimestamp: requests === 0 ? null : 1_792_300_000_000,
  };
  return {
    status: "available",
    source: "omp_stats_db",
    range,
    fetchedAt: "2026-10-18T12:00:00.000Z",
    scope: { kind: "host_profile", profile: "default" },
    indexedThrough: metrics.lastTimestamp,
    overall: metrics,
    byProvider: requests === 0 ? [] : [{ ...metrics, provider: "openai-codex" }],
    byModel: requests === 0 ? [] : [{ ...metrics, provider: "openai-codex", model: "gpt-5.4" }],
    byAgentType: requests === 0 ? [] : [{ ...metrics, agentType: "subagent" }],
  };
}
function page(serverId = "first") {
  return (
    <QueryClientProvider client={queryClient}>
      <OmpStatsSettingsSection serverId={serverId} />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: {
      en: { translation: { providerUsage: providerUsage.en } },
      "zh-CN": { translation: { providerUsage: providerUsage["zh-CN"] } },
    },
    interpolation: { escapeValue: false },
  });
  runtime.t = (key, options) => i18n.t(key, options);
  runtime.connected = true;
  runtime.supported = true;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  runtime.clients = {};
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("renders source-backed counts, cost, scope and all fixed labels in Chinese", async () => {
  let resolve: (payload: StatsPayload) => void = () => {
    throw new Error("No pending request");
  };
  runtime.clients.first = {
    getOmpStats: vi.fn(
      () =>
        new Promise<StatsPayload>((done) => {
          resolve = done;
        }),
    ),
  };
  render(page());
  expect(screen.getByText("正在加载原生统计…")).toBeTruthy();
  resolve({ requestId: "stats", stats: snapshot() });
  const section = await screen.findByTestId("omp-native-stats-summary");
  expect(within(section).getByText("此主机 · 配置：默认配置")).toBeTruthy();
  expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("2");
  expect(screen.getByTestId("omp-native-stats-totalTokens").textContent).toBe("246");
  expect(screen.getByTestId("omp-native-stats-cost").textContent).toBe("US$2.50");
  expect(screen.getByText("子代理")).toBeTruthy();
  expect(screen.getByText("openai-codex / gpt-5.4")).toBeTruthy();
  expect(screen.getByText("最近 1 小时")).toBeTruthy();
  expect(screen.getByText("全部时间")).toBeTruthy();
  const model = screen.getByTestId("omp-native-stats-byModel-row");
  expect(within(model).getByTestId("omp-native-stats-breakdown-label").textContent).toBe(
    "openai-codex / gpt-5.4",
  );
  expect(within(model).getByTestId("omp-native-stats-breakdown-metrics").textContent).toBe(
    "2 次请求 · 246 词元 · US$2.50",
  );
  expect(screen.getByText(/包含已报告的服务商编排词元/)).toBeTruthy();
  expect(screen.getByTestId("omp-native-stats-indexedThrough").textContent).toContain(
    "最新已索引请求：",
  );
  expect(screen.getByTestId("omp-native-stats-fetchedAt").textContent).toContain("索引读取时间：");
  const content = screen.getByTestId("omp-native-stats-section").textContent;
  expect(content).toContain("索引由原生 /stats 管理");
  expect(content).toContain("不代表订阅扣费或账单");
  expect(content).not.toMatch(
    /Loading|Refresh|Requests|Input tokens|Main agent|Subagent|Unavailable/,
  );
});

it("distinguishes unpriced usage from a recorded zero in summary and breakdown costs", async () => {
  let cost = 0;
  let unpricedRequests = 2;
  runtime.clients.first = {
    getOmpStats: async () => {
      const stats = snapshot();
      for (const metrics of [
        stats.overall,
        ...stats.byModel,
        ...stats.byProvider,
        ...stats.byAgentType,
      ]) {
        metrics.totalCostUsd = cost;
        metrics.unpricedRequests = unpricedRequests;
      }
      return { requestId: "stats", stats };
    },
  };
  render(page());
  await screen.findByTestId("omp-native-stats-summary");
  expect(screen.getByTestId("omp-native-stats-cost").textContent).toBe("未定价");
  const row = within(screen.getByTestId("omp-native-stats-byModel-row"));
  expect(row.getByTestId("omp-native-stats-breakdown-metrics").textContent).toBe(
    "2 次请求 · 246 词元 · 未定价",
  );
  expect(row.getByText("有 2 次请求缺少公开等价价格，其费用未计入总额。")).toBeTruthy();
  cost = 1.25;
  unpricedRequests = 1;
  fireEvent.click(screen.getByTestId("omp-native-stats-refresh"));
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-cost").textContent).toBe("US$1.25"),
  );
  expect(row.getByText("有 1 次请求缺少公开等价价格，其费用未计入总额。")).toBeTruthy();
  cost = 0;
  fireEvent.click(screen.getByTestId("omp-native-stats-refresh"));
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-cost").textContent).toBe("US$0.00"),
  );
  for (const group of ["byModel", "byProvider", "byAgentType"]) {
    const breakdown = within(screen.getByTestId(`omp-native-stats-${group}-row`));
    expect(breakdown.getByTestId("omp-native-stats-breakdown-metrics").textContent).toBe(
      "2 次请求 · 246 词元 · US$0.00",
    );
    expect(breakdown.getByText("有 1 次请求缺少公开等价价格，其费用未计入总额。")).toBeTruthy();
  }
  unpricedRequests = 0;
  fireEvent.click(screen.getByTestId("omp-native-stats-refresh"));
  await waitFor(() => expect(row.queryByText(/缺少公开等价价格/)).toBeNull());
  expect(screen.getByTestId("omp-native-stats-cost").textContent).toBe("US$0.00");
});

it("refreshes previously cached ranges from the same native index", async () => {
  let recent = 2;
  let all = 9;
  runtime.clients.first = {
    getOmpStats: async ({ range = "24h" } = {}) => ({
      requestId: "stats",
      stats: snapshot(range === "all" ? all : recent, range),
    }),
  };
  render(page());
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("2"),
  );
  fireEvent.click(screen.getByTestId("omp-native-stats-range-all"));
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("9"),
  );
  fireEvent.click(screen.getByTestId("omp-native-stats-range-24h"));
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("2"),
  );
  recent = 5;
  all = 12;
  fireEvent.click(screen.getByTestId("omp-native-stats-refresh"));
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("5"),
  );
  fireEvent.click(screen.getByTestId("omp-native-stats-range-all"));
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("12"),
  );
  expect(screen.getByTestId("omp-native-stats-totalTokens").textContent).toBe("1,476");
  expect(screen.getByTestId("omp-native-stats-cost").textContent).toBe("US$15.00");
});

it("does not leak a previous host's late result when switching hosts", async () => {
  let resolveFirst: (payload: StatsPayload) => void = () => {
    throw new Error("No pending request");
  };
  runtime.clients.first = {
    getOmpStats: () =>
      new Promise<StatsPayload>((done) => {
        resolveFirst = done;
      }),
  };
  runtime.clients.second = {
    getOmpStats: async () => ({ requestId: "second", stats: snapshot(9) }),
  };
  const rendered = render(page("first"));
  rendered.rerender(page("second"));
  await waitFor(() =>
    expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("9"),
  );
  resolveFirst({ requestId: "first", stats: snapshot(99) });
  await waitFor(() => expect(queryClient.getQueryData(["ompStats", "first", "24h"])).toBeTruthy());
  expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("9");
});

it("distinguishes missing and corrupt sources from indexed zero use in Chinese", async () => {
  const read = vi.fn<NonNullable<typeof runtime.clients.first>["getOmpStats"]>();
  read.mockResolvedValueOnce({
    requestId: "stats",
    stats: {
      status: "unavailable",
      reason: "missing",
      range: "24h",
      source: "omp_stats_db",
      fetchedAt: "2026-10-18T12:00:00.000Z",
      scope: { kind: "host_profile", profile: "default" },
    },
  });
  read.mockResolvedValueOnce({
    requestId: "stats",
    stats: {
      status: "error",
      reason: "unreadable",
      range: "24h",
      source: "omp_stats_db",
      fetchedAt: "2026-10-18T12:00:00.000Z",
      scope: { kind: "host_profile", profile: "default" },
    },
  });
  read.mockResolvedValueOnce({ requestId: "stats", stats: snapshot(0) });
  runtime.clients.first = { getOmpStats: read };
  render(page());
  await screen.findByText(/尚无原生统计索引/);
  expect(screen.queryByTestId("omp-native-stats-summary")).toBeNull();
  fireEvent.click(screen.getByText("重试"));
  await screen.findByText(/未使用零值代替/);
  fireEvent.click(screen.getByText("重试"));
  await screen.findByText("此时间范围内暂无已索引请求");
  expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("0");
  expect(screen.getByText("原生索引中暂无请求")).toBeTruthy();
});

it("marks a failed refresh instead of silently presenting an old snapshot as fresh", async () => {
  const read = vi
    .fn<NonNullable<typeof runtime.clients.first>["getOmpStats"]>()
    .mockResolvedValueOnce({ requestId: "stats", stats: snapshot(2) })
    .mockRejectedValueOnce(new Error("private raw transport error"));
  runtime.clients.first = { getOmpStats: read };
  render(page());
  await screen.findByTestId("omp-native-stats-summary");
  fireEvent.click(screen.getByTestId("omp-native-stats-refresh"));
  await screen.findByText("刷新失败，当前仍显示上次读取的索引快照。");
  expect(screen.getByTestId("omp-native-stats-requests").textContent).toBe("2");
  expect(screen.queryByText(/private raw/)).toBeNull();
});

it("shows connection/upgrade requirements without requesting native data", async () => {
  const read = vi.fn();
  runtime.clients.first = { getOmpStats: read };
  runtime.connected = false;
  const rendered = render(page());
  expect(screen.getByText("连接此主机后可查看其原生统计")).toBeTruthy();
  runtime.connected = true;
  runtime.supported = false;
  rendered.rerender(page());
  expect(screen.getByText("请更新此主机以启用原生统计")).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
});

it("rejects a mismatched response range instead of mislabeling its statistics", async () => {
  runtime.clients.first = {
    getOmpStats: async () => ({ requestId: "stats", stats: snapshot(2, "7d") }),
  };
  render(page());
  await screen.findByText("主机未能返回原生统计");
  expect(screen.queryByTestId("omp-native-stats-summary")).toBeNull();
});

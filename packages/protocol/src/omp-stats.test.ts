import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";
import { OmpStatsMetricsSchema, OmpStatsResultSchema } from "./omp-stats.js";

const metrics = {
  totalRequests: 0,
  failedRequests: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheReadTokens: 0,
  totalCacheWriteTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  unpricedRequests: 0,
  transcriptCount: 0,
  firstTimestamp: null,
  lastTimestamp: null,
};
const snapshot = {
  status: "available",
  source: "omp_stats_db",
  range: "24h",
  fetchedAt: "2026-10-18T12:00:00.000Z",
  scope: { kind: "host_profile", profile: "default" },
  indexedThrough: null,
  overall: metrics,
  byModel: [],
  byProvider: [],
  byAgentType: [],
};

describe("native statistics RPC", () => {
  it("validates the range request and rejects local path input", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "omp.stats.get.request",
        requestId: "stats",
        range: "30d",
      }),
    ).toEqual({ type: "omp.stats.get.request", requestId: "stats", range: "30d" });
    for (const extra of [{ range: "today" }, { path: "/private/stats.db" }, { range: undefined }]) {
      expect(
        SessionInboundMessageSchema.safeParse({
          type: "omp.stats.get.request",
          requestId: "stats",
          range: "24h",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts an indexed zero and keeps unavailable distinct from zero", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "omp.stats.get.response",
        payload: { requestId: "stats", stats: snapshot },
      }),
    ).toMatchObject({ payload: { stats: { status: "available", overall: { totalRequests: 0 } } } });
    expect(
      OmpStatsResultSchema.parse({
        source: "omp_stats_db",
        range: "24h",
        fetchedAt: snapshot.fetchedAt,
        scope: snapshot.scope,
        status: "unavailable",
        reason: "missing",
      }),
    ).not.toHaveProperty("overall");
    for (const reason of ["index_refresh_failed", "index_refresh_timeout"]) {
      const response = SessionOutboundMessageSchema.parse({
        type: "omp.stats.get.response",
        payload: {
          requestId: "stats",
          stats: {
            source: snapshot.source,
            range: snapshot.range,
            fetchedAt: snapshot.fetchedAt,
            scope: snapshot.scope,
            status: "error",
            reason,
            overall: metrics,
            stderr: "private native diagnostic",
          },
        },
      });
      expect(response).toMatchObject({ payload: { stats: { status: "error", reason } } });
      expect(response).not.toHaveProperty("payload.stats.overall");
      expect(response).not.toHaveProperty("payload.stats.stderr");
    }
  });

  it("rejects invalid unknown aggregate facts and agent types", () => {
    for (const invalid of [
      { totalRequests: -1 },
      { totalInputTokens: "100" },
      { totalCostUsd: Number.NaN },
      { totalOutputTokens: Number.MAX_SAFE_INTEGER + 1 },
      { totalTokens: Number.MAX_SAFE_INTEGER + 1 },
      { lastTimestamp: -1 },
    ]) {
      expect(OmpStatsMetricsSchema.safeParse({ ...metrics, ...invalid }).success).toBe(false);
    }
    expect(
      OmpStatsResultSchema.safeParse({
        ...snapshot,
        byAgentType: [{ ...metrics, agentType: "unknown" }],
      }).success,
    ).toBe(false);
    expect(OmpStatsResultSchema.safeParse({ ...snapshot, overall: null }).success).toBe(false);
  });
});

import { z } from "zod";

export const OmpStatsRangeSchema = z.enum(["1h", "24h", "7d", "30d", "90d", "all"]);
export type OmpStatsRange = z.infer<typeof OmpStatsRangeSchema>;

const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const TimestampSchema = z.number().int().nonnegative().max(8_640_000_000_000_000).nullable();

/** Numeric facts from OMP's indexed requests, never provider account limits. */
export const OmpStatsMetricsSchema = z.object({
  totalRequests: CountSchema,
  failedRequests: CountSchema,
  totalInputTokens: CountSchema,
  totalOutputTokens: CountSchema,
  totalCacheReadTokens: CountSchema,
  totalCacheWriteTokens: CountSchema,
  /** Native recorded total, including orchestration; not a sum of the displayed buckets. */
  totalTokens: CountSchema,
  /** Native API-equivalent USD cost, not an invoice or subscription charge. */
  totalCostUsd: z.number().nonnegative(),
  unpricedRequests: CountSchema,
  /** Distinct indexed transcript files with a request in the range, including child agents. */
  transcriptCount: CountSchema,
  firstTimestamp: TimestampSchema,
  lastTimestamp: TimestampSchema,
});
export type OmpStatsMetrics = z.infer<typeof OmpStatsMetricsSchema>;

const OmpStatsMetadataSchema = z.object({
  range: OmpStatsRangeSchema,
  fetchedAt: z.string().datetime(),
  source: z.literal("omp_stats_db"),
  scope: z.object({
    kind: z.literal("host_profile"),
    profile: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  }),
});

export const OmpStatsSnapshotSchema = OmpStatsMetadataSchema.extend({
  status: z.literal("available"),
  /** Most recent request in the entire index, NOT the time of a successful native sync. */
  indexedThrough: TimestampSchema,
  overall: OmpStatsMetricsSchema,
  byModel: z.array(
    OmpStatsMetricsSchema.extend({ provider: z.string().min(1), model: z.string().min(1) }),
  ),
  byProvider: z.array(OmpStatsMetricsSchema.extend({ provider: z.string().min(1) })),
  byAgentType: z.array(
    OmpStatsMetricsSchema.extend({ agentType: z.enum(["main", "subagent", "advisor"]) }),
  ),
});
export type OmpStatsSnapshot = z.infer<typeof OmpStatsSnapshotSchema>;

export const OmpStatsResultSchema = z.discriminatedUnion("status", [
  OmpStatsSnapshotSchema,
  OmpStatsMetadataSchema.extend({
    status: z.literal("unavailable"),
    reason: z.enum(["missing", "unsupported_schema", "scope_unavailable", "provider_unavailable"]),
  }),
  OmpStatsMetadataSchema.extend({
    status: z.literal("error"),
    reason: z.enum(["unreadable", "invalid_data"]),
  }),
]);
export type OmpStatsResult = z.infer<typeof OmpStatsResultSchema>;

export const OmpStatsGetRequestMessageSchema = z
  .object({
    type: z.literal("omp.stats.get.request"),
    requestId: z.string(),
    range: OmpStatsRangeSchema,
  })
  .strict();

export const OmpStatsGetResponseMessageSchema = z.object({
  type: z.literal("omp.stats.get.response"),
  payload: z.object({ requestId: z.string(), stats: OmpStatsResultSchema }),
});
export type OmpStatsGetResponseMessage = z.infer<typeof OmpStatsGetResponseMessageSchema>;

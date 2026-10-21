import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { OmpStatsMetricsSchema, OmpStatsResultSchema } from "@omp-desktop/protocol/omp-stats";

const RANGE_MS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
  all: null,
};
const REQUIRED_COLUMNS = [
  "session_file",
  "provider",
  "model",
  "agent_type",
  "timestamp",
  "stop_reason",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_tokens",
  "cost_total",
  "cost_unpriced",
];
const FACTS_SQL = `
  COUNT(*) AS totalRequests,
  COALESCE(SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END), 0) AS failedRequests,
  COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
  COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
  COALESCE(SUM(cache_read_tokens), 0) AS totalCacheReadTokens,
  COALESCE(SUM(cache_write_tokens), 0) AS totalCacheWriteTokens,
  COALESCE(SUM(total_tokens), 0) AS totalTokens,
  TOTAL(cost_total) AS totalCostUsd,
  COALESCE(SUM(CASE WHEN total_tokens > 0 AND cost_total = 0
    AND (provider = 'xai-oauth' OR cost_unpriced = 1) THEN 1 ELSE 0 END), 0) AS unpricedRequests,
  COUNT(DISTINCT session_file) AS transcriptCount,
  MIN(timestamp) AS firstTimestamp, MAX(timestamp) AS lastTimestamp`;
const INVALID_ROW_SQL = [
  ...[
    "timestamp",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "total_tokens",
  ].map((column) => `(typeof(${column}) != 'integer' OR ${column} < 0)`),
  "(typeof(cost_total) NOT IN ('integer', 'real') OR cost_total < 0)",
  "(typeof(cost_unpriced) != 'integer' OR cost_unpriced NOT IN (0, 1))",
  ...["session_file", "provider", "model", "stop_reason"].map(
    (column) => `(typeof(${column}) != 'text' OR length(${column}) = 0)`,
  ),
  "(agent_type NOT IN ('main', 'subagent', 'advisor') OR agent_type IS NULL)",
].join(" OR ");

function readStats({ path, now, metadata }) {
  let database;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    database.exec("PRAGMA busy_timeout = 1000; BEGIN");
    const columns = z
      .array(z.object({ name: z.string() }))
      .parse(database.prepare("PRAGMA table_info(messages)").all());
    if (!REQUIRED_COLUMNS.every((column) => columns.some(({ name }) => name === column))) {
      return { ...metadata, status: "unavailable", reason: "unsupported_schema" };
    }
    const span = RANGE_MS[metadata.range];
    const where = span === null ? "" : "WHERE timestamp >= ?";
    const params = span === null ? [] : [now - span];
    if (
      database
        .prepare(`SELECT 1 FROM messages ${where ? `${where} AND` : "WHERE"}
      (${INVALID_ROW_SQL}) LIMIT 1`)
        .get(...params)
    ) {
      return { ...metadata, status: "error", reason: "invalid_data" };
    }
    const overall = OmpStatsMetricsSchema.parse(
      database.prepare(`SELECT ${FACTS_SQL} FROM messages ${where}`).get(...params),
    );
    const index = z
      .object({ indexedThrough: z.number().int().nonnegative().nullable() })
      .parse(database.prepare("SELECT MAX(timestamp) AS indexedThrough FROM messages").get());
    return OmpStatsResultSchema.parse({
      ...metadata,
      status: "available",
      ...index,
      overall,
      byModel: database
        .prepare(`SELECT provider, model, ${FACTS_SQL} FROM messages ${where}
        GROUP BY provider, model ORDER BY totalRequests DESC, provider, model`)
        .all(...params),
      byProvider: database
        .prepare(`SELECT provider, ${FACTS_SQL} FROM messages ${where}
        GROUP BY provider ORDER BY totalRequests DESC, provider`)
        .all(...params),
      byAgentType: database
        .prepare(`SELECT agent_type AS agentType, ${FACTS_SQL} FROM messages ${where}
        GROUP BY agent_type ORDER BY agent_type`)
        .all(...params),
    });
  } catch (error) {
    // Paths and raw SQLite errors never cross the worker message boundary.
    return {
      ...metadata,
      status: "error",
      reason: error instanceof z.ZodError ? "invalid_data" : "unreadable",
    };
  } finally {
    database?.close();
  }
}

process.once("message", (options) => {
  let result;
  try {
    // Complete the readonly transaction and close its handle before posting data.
    result = readStats(options);
  } catch {
    result = { ...options.metadata, status: "error", reason: "unreadable" };
  }
  process.send(result, () => {
    if (process.connected) process.disconnect();
  });
});

import type { OmpProviderAccountQuota } from "@omp-desktop/protocol/messages";

export const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface CodexAccountQuotaCredential {
  accessToken: string;
  accountId?: string;
}

export interface CodexAccountQuotaFetchOptions {
  credential: CodexAccountQuotaCredential;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseUsedPct(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function parseResetAt(value: unknown): string | null {
  const seconds = finiteNumber(value);
  if (seconds === null || seconds <= 0) return null;
  const milliseconds = seconds > 1_000_000_000_000 ? seconds : seconds * 1_000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseWindow(value: unknown): { usedPct: number | null; resetsAt: string | null } | null {
  if (!isRecord(value)) return null;
  const usedPct = parseUsedPct(value.used_percent);
  const resetsAt = parseResetAt(value.reset_at);
  if (usedPct === null && resetsAt === null) return null;
  return { usedPct, resetsAt };
}

function failure(
  status: "unavailable" | "error",
  error: string,
  now: () => number,
): OmpProviderAccountQuota {
  return {
    status,
    fiveHourUsedPct: null,
    fiveHourLimitReached: null,
    fiveHourResetsAt: null,
    weeklyUsedPct: null,
    weeklyResetsAt: null,
    fetchedAt: new Date(now()).toISOString(),
    error,
  };
}

export async function fetchCodexAccountQuota(
  options: CodexAccountQuotaFetchOptions,
): Promise<OmpProviderAccountQuota> {
  const now = options.now ?? Date.now;
  const accessToken = options.credential.accessToken.trim();
  if (!accessToken) {
    return failure("unavailable", "Codex account credential is unavailable", now);
  }

  const fetchApi = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    if (options.credential.accountId) {
      headers["ChatGPT-Account-Id"] = options.credential.accountId;
    }
    const response = await fetchApi(CODEX_USAGE_ENDPOINT, {
      headers,
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return failure("unavailable", "Codex account authentication expired", now);
    }
    if (!response.ok) {
      return failure("error", `Codex usage request failed (HTTP ${response.status})`, now);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failure("error", "Codex usage response was not valid JSON", now);
    }
    if (!isRecord(payload) || !isRecord(payload.rate_limit)) {
      return failure("error", "Codex usage response did not include rate limits", now);
    }

    const primary = parseWindow(payload.rate_limit.primary_window);
    const secondary = parseWindow(payload.rate_limit.secondary_window);
    if (!primary) {
      return failure("error", "Codex usage response did not include the five-hour limit", now);
    }

    const fetchedAt = new Date(now()).toISOString();
    const planLabel = typeof payload.plan_type === "string" ? payload.plan_type : null;
    return {
      status: "available",
      planLabel,
      fiveHourUsedPct: primary.usedPct,
      fiveHourLimitReached: primary.usedPct === null ? null : primary.usedPct >= 100,
      fiveHourResetsAt: primary.resetsAt,
      weeklyUsedPct: secondary?.usedPct ?? null,
      weeklyResetsAt: secondary?.resetsAt ?? null,
      fetchedAt,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return failure("error", "Codex usage request timed out", now);
    }
    return failure("error", "Codex usage request failed", now);
  } finally {
    clearTimeout(timeout);
  }
}

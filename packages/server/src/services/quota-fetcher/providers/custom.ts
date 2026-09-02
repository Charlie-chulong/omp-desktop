import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageWindow,
} from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  ApiNumberSchema,
  balanceToneFromRemaining,
  fetchProviderApi,
  toneFromUsedPct,
  usedPctOf,
  windowFromUsedPct,
} from "../usage.js";

const OptionalNumberSchema = ApiNumberSchema.nullable().optional();
const ResetAtSchema = z.union([z.string(), z.number()]).nullable().optional();
const UsageResponseSchema = z.object({
  isValid: z.boolean().optional(),
  message: z.string().optional(),
  planName: z.string().optional(),
  remaining: OptionalNumberSchema,
  unit: z.string().optional(),
  subscription: z
    .object({
      daily_usage_usd: OptionalNumberSchema,
      daily_limit_usd: OptionalNumberSchema,
      weekly_usage_usd: OptionalNumberSchema,
      weekly_limit_usd: OptionalNumberSchema,
      monthly_usage_usd: OptionalNumberSchema,
      monthly_limit_usd: OptionalNumberSchema,
    })
    .nullable()
    .optional(),
  quota: z
    .object({
      used: OptionalNumberSchema,
      limit: OptionalNumberSchema,
      remaining: OptionalNumberSchema,
      unit: z.string().optional(),
    })
    .nullable()
    .optional(),
  rate_limits: z
    .array(
      z.object({
        window: z.string(),
        used: OptionalNumberSchema,
        limit: OptionalNumberSchema,
        remaining: OptionalNumberSchema,
        reset_at: ResetAtSchema,
      }),
    )
    .optional(),
  usage: z
    .object({
      total: z
        .object({
          cost: OptionalNumberSchema,
        })
        .optional(),
    })
    .optional(),
});

export interface CustomQuotaProviderOptions {
  providerId: string;
  displayName?: string;
  baseUrl: string;
  apiKey: string;
  logger: Logger;
  fetch?: ProviderApiFetch;
}

function usageEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? `${path}/usage` : `${path}/v1/usage`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
function normalizeUnit(value: string | undefined): ProviderUsageBalance["unit"] {
  switch (value?.toLowerCase()) {
    case "credits":
    case "requests":
    case "tokens":
      return value.toLowerCase() as ProviderUsageBalance["unit"];
    default:
      return "usd";
  }
}

function resetAtToIso(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  const numeric = Number(value);
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(milliseconds);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function subscriptionWindows(
  subscription: NonNullable<z.infer<typeof UsageResponseSchema>["subscription"]>,
): ProviderUsageWindow[] {
  const definitions = [
    ["daily", "Daily", subscription.daily_usage_usd, subscription.daily_limit_usd],
    ["weekly", "Weekly", subscription.weekly_usage_usd, subscription.weekly_limit_usd],
    ["monthly", "Monthly", subscription.monthly_usage_usd, subscription.monthly_limit_usd],
  ] as const;
  return definitions.flatMap(([id, label, used, limit]) => {
    if (typeof limit !== "number" || limit <= 0) return [];
    return [windowFromUsedPct({ id, label, utilizationPct: usedPctOf(used, limit) })];
  });
}

export class CustomQuotaProvider implements ProviderUsageFetcher {
  readonly providerId: string;
  readonly displayName: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;

  constructor(options: CustomQuotaProviderOptions) {
    this.providerId = options.providerId;
    this.displayName = options.displayName ?? options.providerId;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.logger = options.logger.child({ providerId: options.providerId });
    this.fetchApi = options.fetch ?? fetch;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const endpoint = usageEndpoint(this.baseUrl);
    const response = await fetchProviderApi(this.fetchApi, endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : `Usage request failed (${response.status})`;
      throw new Error(message);
    }

    const parsed = UsageResponseSchema.parse(body);
    if (parsed.isValid === false) {
      throw new Error(parsed.message ?? "API key is invalid");
    }

    const unit = normalizeUnit(parsed.unit ?? parsed.quota?.unit);
    let windows: ProviderUsageWindow[] = [];
    let balances: ProviderUsageBalance[] = [];

    if (parsed.subscription) {
      windows = subscriptionWindows(parsed.subscription);
      if (windows.length === 0 && typeof parsed.remaining === "number" && parsed.remaining >= 0) {
        balances = [
          {
            id: "subscription",
            label: "Balance",
            remaining: parsed.remaining,
            unit,
            tone: balanceToneFromRemaining(parsed.remaining),
          },
        ];
      }
    } else if (parsed.quota) {
      const { used, limit, remaining } = parsed.quota;
      balances = [
        {
          id: "quota",
          label: "API key quota",
          used,
          limit,
          remaining,
          unit,
          tone: toneFromUsedPct(usedPctOf(used, limit)),
        },
      ];
    } else if (parsed.rate_limits?.length) {
      windows = parsed.rate_limits.map((rateLimit, index) => {
        const usedPct = usedPctOf(rateLimit.used, rateLimit.limit);
        return windowFromUsedPct({
          id: `rate-limit-${index}`,
          label: rateLimit.window,
          utilizationPct: usedPct,
          resetsAt: resetAtToIso(rateLimit.reset_at),
          tone: toneFromUsedPct(usedPct),
        });
      });
    } else {
      const remaining = parsed.remaining;
      const used = parsed.usage?.total?.cost;
      balances = [
        {
          id: "balance",
          label: "Balance",
          used,
          remaining,
          unit,
          tone: balanceToneFromRemaining(remaining),
        },
      ];
    }

    this.logger.debug({ endpoint }, "Fetched custom provider usage");
    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: parsed.planName ?? null,
      sourceLabel: new URL(endpoint).host,
      fetchedAt: new Date().toISOString(),
      windows,
      balances,
      details: [],
      error: null,
    };
  }
}

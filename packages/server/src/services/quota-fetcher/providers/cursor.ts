import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type { ProviderUsage, ProviderUsageBalance } from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  ApiNumberSchema,
  fetchProviderApi,
  toIsoStringOrNull,
  toneFromUsedPct,
  unavailableUsage,
  usedPctOf,
} from "../usage.js";

const CURSOR_USAGE_ENDPOINT =
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

const CursorUsageResponseSchema = z.object({
  planUsage: z
    .object({
      totalSpend: ApiNumberSchema,
      includedSpend: ApiNumberSchema.optional(),
      bonusSpend: ApiNumberSchema.optional(),
      remaining: ApiNumberSchema,
      limit: ApiNumberSchema,
    })
    .optional(),
  billingCycleStart: z.union([z.string(), z.number()]).nullable().optional(),
  billingCycleEnd: z.union([z.string(), z.number()]).nullable().optional(),
});

const CursorRequestUsageBucketSchema = z.object({
  numRequests: ApiNumberSchema,
  maxRequestUsage: ApiNumberSchema.nullable(),
});
const CursorTeamsResponseSchema = z.object({
  teams: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
    }),
  ),
});

const CursorTeamSpendResponseSchema = z.object({
  teamMemberSpend: z
    .array(
      z.object({
        email: z.string().optional(),
        spendCents: ApiNumberSchema.optional(),
        monthlyLimitDollars: ApiNumberSchema.optional(),
        effectivePerUserLimitDollars: ApiNumberSchema.optional(),
      }),
    )
    .optional(),
  nextCycleStart: z.union([z.string(), z.number()]).nullable().optional(),
});

interface SqliteStatement {
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface CursorQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  homeDir?: string;
  platform?: NodeJS.Platform;
  appDataDir?: string;
}

const moduleRequire = createRequire(import.meta.url);

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8").trim() || null;
  return null;
}

function tokenFromLegacyValue(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { accessToken?: unknown };
    return typeof parsed.accessToken === "string" ? parsed.accessToken.trim() || null : null;
  } catch {
    return null;
  }
}

function tokenFromStateDatabase(path: string): string | null {
  const { DatabaseSync } = moduleRequire("node:sqlite") as {
    DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => SqliteDatabase;
  };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const statement = database.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const modern = statement.get("cursorAuth/accessToken") as { value?: unknown } | undefined;
    const modernToken = textValue(modern?.value);
    if (modernToken) return modernToken;

    const legacy = statement.get("cursorAuthStatus") as { value?: unknown } | undefined;
    return tokenFromLegacyValue(legacy?.value);
  } finally {
    database.close();
  }
}
function emailFromStateDatabase(path: string): string | null {
  const { DatabaseSync } = moduleRequire("node:sqlite") as {
    DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => SqliteDatabase;
  };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const statement = database.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const row = statement.get("cursorAuth/cachedEmail") as { value?: unknown } | undefined;
    return textValue(row?.value)?.toLowerCase() ?? null;
  } finally {
    database.close();
  }
}

function cursorStateDatabasePath(input: {
  homeDir: string;
  platform: NodeJS.Platform;
  appDataDir?: string;
}): string {
  if (input.platform === "darwin") {
    return join(
      input.homeDir,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  if (input.platform === "win32") {
    return join(
      input.appDataDir ?? join(input.homeDir, "AppData", "Roaming"),
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  return join(input.homeDir, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

function tokenFromAgentAuth(homeDir: string): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(homeDir, ".config", "cursor", "auth.json"), "utf8"),
    ) as { accessToken?: unknown };
    return typeof parsed.accessToken === "string" ? parsed.accessToken.trim() || null : null;
  } catch {
    return null;
  }
}

function cents(value: number): number {
  return value / 100;
}

function billingReset(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const numericTimestamp = typeof value === "number" ? value : Number(value);
  return toIsoStringOrNull(
    Number.isFinite(numericTimestamp) ? numericTimestamp : Date.parse(String(value)),
  );
}

function nextMonthlyReset(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const start = new Date(value);
  if (!Number.isFinite(start.getTime())) return null;
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
}

export class CursorQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "cursor";
  readonly displayName = "Cursor";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly homeDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly appDataDir: string | undefined;

  constructor(options: CursorQuotaProviderOptions) {
    this.logger = options.logger.child({ providerId: this.providerId });
    this.fetchApi = options.fetch ?? fetch;
    this.homeDir = options.homeDir ?? homedir();
    this.platform = options.platform ?? process.platform;
    this.appDataDir = options.appDataDir ?? process.env["APPDATA"];
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const token = this.readAccessToken();
    if (!token) return unavailableUsage(this);

    const response = await fetchProviderApi(this.fetchApi, CURSOR_USAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return unavailableUsage(this);
      throw new Error(`Cursor usage request failed with HTTP ${response.status}`);
    }

    const payload = CursorUsageResponseSchema.parse(await response.json());
    if (!payload.planUsage) {
      try {
        const teamBalance = await this.fetchTeamSpendBalance(token);
        if (teamBalance) {
          return {
            providerId: this.providerId,
            displayName: this.displayName,
            status: "available",
            planLabel: null,
            sourceLabel: "Cursor",
            windows: [],
            balances: [teamBalance],
            details: [],
            error: null,
          };
        }
      } catch (err) {
        this.logger.debug({ err }, "Failed to fetch Cursor team spend");
      }
      return this.fetchRequestUsage(token, billingReset(payload.billingCycleEnd));
    }

    const used = cents(payload.planUsage.totalSpend);
    const remaining = cents(payload.planUsage.remaining);
    const limit = cents(payload.planUsage.limit);
    const usedPct = usedPctOf(used, limit);

    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: null,
      sourceLabel: "Cursor",
      windows: [],
      balances: [
        {
          id: "plan_usage",
          label: "Plan usage",
          used,
          remaining,
          limit,
          unit: "usd",
          resetsAt: billingReset(payload.billingCycleEnd),
          tone: toneFromUsedPct(usedPct),
        },
      ],
      details: [],
      error: null,
    };
  }
  private async fetchTeamSpendBalance(token: string): Promise<ProviderUsageBalance | null> {
    const email = this.readCachedEmail();
    if (!email) return null;

    const teamsResponse = await this.fetchDashboardRpc(token, "GetTeams", {});
    if (!teamsResponse.ok) {
      throw new Error(`Cursor teams request failed with HTTP ${teamsResponse.status}`);
    }
    const { teams } = CursorTeamsResponseSchema.parse(await teamsResponse.json());

    for (const team of teams) {
      const spendResponse = await this.fetchDashboardRpc(token, "GetTeamSpend", {
        teamId: team.id,
      });
      if (!spendResponse.ok) continue;

      const payload = CursorTeamSpendResponseSchema.parse(await spendResponse.json());
      const member = payload.teamMemberSpend?.find(
        (candidate) => candidate.email?.trim().toLowerCase() === email,
      );
      if (member?.spendCents == null) continue;

      const used = cents(member.spendCents);
      const limit = member.effectivePerUserLimitDollars ?? member.monthlyLimitDollars ?? null;
      return {
        id: "team_spend",
        label: "Monthly usage",
        used,
        remaining: limit == null ? null : Math.max(0, limit - used),
        limit,
        unit: "usd",
        resetsAt: billingReset(payload.nextCycleStart),
        tone: toneFromUsedPct(usedPctOf(used, limit)),
      };
    }
    return null;
  }

  private fetchDashboardRpc(
    token: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return fetchProviderApi(
      this.fetchApi,
      `https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
        body: JSON.stringify(body),
      },
    );
  }

  private async fetchRequestUsage(token: string, resetsAt: string | null): Promise<ProviderUsage> {
    const response = await fetchProviderApi(this.fetchApi, "https://api2.cursor.sh/auth/usage", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return unavailableUsage(this);
      throw new Error(`Cursor request usage failed with HTTP ${response.status}`);
    }

    const payload = z.record(z.string(), z.unknown()).parse(await response.json());
    const buckets = Object.entries(payload).flatMap(([model, value]) => {
      const parsed = CursorRequestUsageBucketSchema.safeParse(value);
      return parsed.success ? [{ model, ...parsed.data }] : [];
    });
    const bucket =
      buckets.find((candidate) => candidate.maxRequestUsage != null) ?? buckets.at(0) ?? null;
    if (!bucket) return unavailableUsage(this);

    const limit = bucket.maxRequestUsage;
    const remaining = limit == null ? null : Math.max(0, limit - bucket.numRequests);
    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: null,
      sourceLabel: "Cursor",
      windows: [],
      balances: [
        {
          id: "monthly_requests",
          label: "Monthly requests",
          used: bucket.numRequests,
          remaining,
          limit,
          unit: "requests",
          resetsAt: nextMonthlyReset(payload["startOfMonth"]) ?? resetsAt,
          tone: toneFromUsedPct(usedPctOf(bucket.numRequests, limit)),
        },
      ],
      details: [{ id: "model", label: "Model", value: bucket.model }],
      error: null,
    };
  }
  private readCachedEmail(): string | null {
    const path = cursorStateDatabasePath({
      homeDir: this.homeDir,
      platform: this.platform,
      appDataDir: this.appDataDir,
    });
    try {
      return emailFromStateDatabase(path);
    } catch (err) {
      this.logger.debug({ err, path }, "Failed to read Cursor email from state database");
      return null;
    }
  }

  private readAccessToken(): string | null {
    const envToken = process.env["CURSOR_ACCESS_TOKEN"] ?? process.env["CURSOR_TOKEN"];
    if (envToken?.trim()) return envToken.trim();

    const path = cursorStateDatabasePath({
      homeDir: this.homeDir,
      platform: this.platform,
      appDataDir: this.appDataDir,
    });
    try {
      const token = tokenFromStateDatabase(path);
      if (token) return token;
    } catch (err) {
      this.logger.debug({ err, path }, "Failed to read Cursor token from state database");
    }

    return tokenFromAgentAuth(this.homeDir);
  }
}

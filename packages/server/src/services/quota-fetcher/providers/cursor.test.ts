import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorQuotaProvider } from "./cursor.js";

const homes: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cursorHome(email: string): string {
  const home = mkdtempSync(join(tmpdir(), "cursor-quota-"));
  homes.push(home);
  const directory = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "state.vscdb"));
  database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  database
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run("cursorAuth/cachedEmail", email);
  database.close();
  return home;
}

function provider(homeDir: string, fetchApi: typeof fetch): CursorQuotaProvider {
  return new CursorQuotaProvider({
    logger: pino({ level: "silent" }),
    fetch: fetchApi,
    homeDir,
    platform: "darwin",
  });
}

afterEach(() => {
  delete process.env["CURSOR_ACCESS_TOKEN"];
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("CursorQuotaProvider team spend", () => {
  it("uses the signed-in member spend when the individual plan usage is absent", async () => {
    process.env["CURSOR_ACCESS_TOKEN"] = "cursor_test_token";
    const home = cursorHome("me@example.com");
    const calls: string[] = [];
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/GetCurrentPeriodUsage")) {
        return jsonResponse({ billingCycleEnd: "1788329751426", displayThreshold: 100 });
      }
      if (url.endsWith("/GetTeams")) {
        return jsonResponse({ teams: [{ id: 10 }, { id: 20 }] });
      }
      if (url.endsWith("/GetTeamSpend")) {
        const body = JSON.parse(String(init?.body)) as { teamId: number };
        if (body.teamId === 10) {
          return jsonResponse({
            teamMemberSpend: [
              {
                email: "admin@example.com",
                spendCents: 99999,
                effectivePerUserLimitDollars: 2000,
              },
              {
                email: "ME@example.com",
                spendCents: 1061,
                overallSpendCents: 1061,
                monthlyLimitDollars: 1000,
                effectivePerUserLimitDollars: 1000,
              },
            ],
            nextCycleStart: "1790812800000",
          });
        }
        return jsonResponse({ teamMemberSpend: [] });
      }
      throw new Error(`Unexpected Cursor endpoint: ${url}`);
    }) as typeof fetch;

    const usage = await provider(home, fetchApi).fetchUsage();

    expect(usage).toMatchObject({
      status: "available",
      balances: [
        {
          id: "team_spend",
          label: "Monthly usage",
          used: 10.61,
          remaining: 989.39,
          limit: 1000,
          unit: "usd",
          resetsAt: "2026-10-01T00:00:00.000Z",
          tone: "ok",
        },
      ],
    });
    expect(calls.some((url) => url.endsWith("/auth/usage"))).toBe(false);
  });

  it("does not request team spend when individual plan usage is available", async () => {
    process.env["CURSOR_ACCESS_TOKEN"] = "cursor_test_token";
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.endsWith("/GetCurrentPeriodUsage")) {
        throw new Error(`Unexpected Cursor endpoint: ${url}`);
      }
      return jsonResponse({
        planUsage: { totalSpend: 1061, remaining: 98939, limit: 100000 },
        billingCycleEnd: "1790812800000",
      });
    }) as typeof fetch;

    const usage = await provider(cursorHome("me@example.com"), fetchApi).fetchUsage();

    expect(usage.balances?.[0]).toMatchObject({ id: "plan_usage", used: 10.61, limit: 1000 });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });

  it("falls back to legacy request usage when team spend fails", async () => {
    process.env["CURSOR_ACCESS_TOKEN"] = "cursor_test_token";
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/GetCurrentPeriodUsage")) return jsonResponse({});
      if (url.endsWith("/GetTeams")) return jsonResponse({}, 500);
      if (url.endsWith("/auth/usage")) {
        return jsonResponse({ gpt: { numRequests: 7, maxRequestUsage: 100 } });
      }
      throw new Error(`Unexpected Cursor endpoint: ${url}`);
    }) as typeof fetch;

    const usage = await provider(cursorHome("me@example.com"), fetchApi).fetchUsage();

    expect(usage.balances?.[0]).toMatchObject({
      id: "monthly_requests",
      used: 7,
      remaining: 93,
      limit: 100,
    });
  });
});

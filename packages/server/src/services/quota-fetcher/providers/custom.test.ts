import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { CustomQuotaProvider } from "./custom.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CustomQuotaProvider", () => {
  it("queries baseUrl/v1/usage with the configured bearer key and returns wallet balance", async () => {
    const fetchApi = vi.fn(async () =>
      jsonResponse({
        planName: "Wallet",
        remaining: 12.5,
        unit: "USD",
        usage: { total: { cost: 3.25 } },
      }),
    );
    const provider = new CustomQuotaProvider({
      providerId: "mintcat",
      baseUrl: "https://codex.mintcat.work",
      apiKey: "secret-key",
      logger: pino({ level: "silent" }),
      fetch: fetchApi as typeof fetch,
    });

    await expect(provider.fetchUsage()).resolves.toMatchObject({
      providerId: "mintcat",
      status: "available",
      planLabel: "Wallet",
      balances: [
        {
          id: "balance",
          used: 3.25,
          remaining: 12.5,
          unit: "usd",
        },
      ],
    });
    expect(fetchApi).toHaveBeenCalledWith(
      "https://codex.mintcat.work/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-key" }),
      }),
    );
  });

  it("does not duplicate v1 and maps subscription limits to usage windows", async () => {
    const fetchApi = vi.fn(async () =>
      jsonResponse({
        planName: "Pro",
        remaining: 40,
        subscription: {
          daily_usage_usd: 2,
          daily_limit_usd: 10,
          weekly_usage_usd: 60,
          weekly_limit_usd: 100,
          monthly_usage_usd: 0,
          monthly_limit_usd: 0,
        },
      }),
    );
    const provider = new CustomQuotaProvider({
      providerId: "mintcat",
      baseUrl: "https://codex.mintcat.work/v1/",
      apiKey: "secret-key",
      logger: pino({ level: "silent" }),
      fetch: fetchApi as typeof fetch,
    });

    await expect(provider.fetchUsage()).resolves.toMatchObject({
      windows: [
        { id: "daily", usedPct: 20, remainingPct: 80 },
        { id: "weekly", usedPct: 60, remainingPct: 40 },
      ],
      balances: [],
    });
    expect(fetchApi).toHaveBeenCalledWith(
      "https://codex.mintcat.work/v1/usage",
      expect.any(Object),
    );
  });
});

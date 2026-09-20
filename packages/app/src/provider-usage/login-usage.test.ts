import { describe, expect, test } from "vitest";
import { resolveLoginProviderUsage } from "./login-usage";
import type { ProviderUsage, ProviderUsageView } from "./types";

function cursorUsage(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    providerId: "cursor",
    displayName: "Cursor",
    status: "available",
    planLabel: null,
    sourceLabel: "Cursor",
    windows: [],
    balances: [
      {
        id: "team_spend",
        label: "Monthly usage",
        used: 480.13,
        remaining: 519.87,
        limit: 1000,
        unit: "usd",
        resetsAt: "2026-09-30T00:00:00.000Z",
      },
    ],
    details: [],
    error: null,
    ...overrides,
  };
}

function readyView(providers: ProviderUsage[]): ProviderUsageView {
  return {
    kind: "ready",
    payload: { providers, fetchedAt: "2026-09-20T00:00:00.000Z" },
    isRefreshing: false,
  };
}

describe("resolveLoginProviderUsage", () => {
  test("returns cursor usage for the matching signed-in provider", () => {
    expect(resolveLoginProviderUsage(readyView([cursorUsage()]), "cursor")?.providerId).toBe(
      "cursor",
    );
  });

  test("ignores Codex login providers that already have account quota", () => {
    expect(
      resolveLoginProviderUsage(
        readyView([cursorUsage({ providerId: "openai-codex", displayName: "Codex" })]),
        "openai-codex",
      ),
    ).toBeNull();
  });

  test("returns null when the usage payload has nothing to render", () => {
    expect(
      resolveLoginProviderUsage(readyView([cursorUsage({ balances: [], windows: [] })]), "cursor"),
    ).toBeNull();
    expect(resolveLoginProviderUsage({ kind: "loading" }, "cursor")).toBeNull();
    expect(
      resolveLoginProviderUsage(readyView([cursorUsage({ status: "unavailable" })]), "cursor"),
    ).toBeNull();
  });
});

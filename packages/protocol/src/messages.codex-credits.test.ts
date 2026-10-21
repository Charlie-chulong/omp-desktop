import { describe, expect, it } from "vitest";
import { OmpProviderAccountQuotaSchema } from "./messages.js";

describe("Codex account credits schema", () => {
  it("preserves the exact decimal balance independently of reset-card inventory", () => {
    const quota = OmpProviderAccountQuotaSchema.parse({
      status: "available",
      fiveHourUsedPct: 20,
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "9007199254740993.000001",
      },
      resetCredits: { status: "available", availableCount: 2, credits: [] },
    });
    expect(quota.credits?.balance).toBe("9007199254740993.000001");
    expect(quota.resetCredits?.availableCount).toBe(2);
    expect(quota.fiveHourUsedPct).toBe(20);
  });

  it("keeps absent and unavailable credits distinct from a zero balance", () => {
    const absent = OmpProviderAccountQuotaSchema.parse({ status: "unavailable" });
    const unavailable = OmpProviderAccountQuotaSchema.parse({ status: "available", credits: null });
    const zero = OmpProviderAccountQuotaSchema.parse({
      status: "available",
      credits: { hasCredits: false, unlimited: false, balance: "0" },
    });
    expect(absent).not.toHaveProperty("credits");
    expect(unavailable.credits).toBeNull();
    expect(zero.credits?.balance).toBe("0");
  });

  it.each([
    { hasCredits: true, unlimited: false, balance: null },
    { hasCredits: false, unlimited: false },
    { hasCredits: true, unlimited: true },
  ])("accepts reported credit flags without a numeric balance: %j", (credits) => {
    const quota = OmpProviderAccountQuotaSchema.parse({ status: "available", credits });
    expect(quota.credits?.hasCredits).toBe(credits.hasCredits);
    expect(quota.credits?.unlimited).toBe(credits.unlimited);
  });

  it.each([
    { hasCredits: true, unlimited: false, balance: 0 },
    { hasCredits: "false", unlimited: false, balance: "0" },
    { hasCredits: true, balance: "12" },
  ])("rejects malformed credit types instead of coercing them: %j", (credits) => {
    expect(OmpProviderAccountQuotaSchema.safeParse({ status: "available", credits }).success).toBe(
      false,
    );
  });
});

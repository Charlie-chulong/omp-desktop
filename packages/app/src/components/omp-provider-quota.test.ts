import { describe, expect, test } from "vitest";
import {
  formatOmpQuotaResetTime,
  resolveOmpRemainingQuotaPct,
  shouldShowOmpFiveHourQuota,
} from "./omp-provider-quota";

describe("OMP provider quota percentage", () => {
  test.each([
    [0, 100],
    [42, 58],
    [100, 0],
    [-10, 100],
    [125, 0],
    [42.5, 57.5],
  ])("converts %s%% used into %s%% remaining", (usedPct, expected) => {
    expect(resolveOmpRemainingQuotaPct(usedPct)).toBe(expected);
  });

  test("returns null when the provider did not report usage", () => {
    expect(resolveOmpRemainingQuotaPct(null)).toBeNull();
    expect(resolveOmpRemainingQuotaPct(undefined)).toBeNull();
    expect(resolveOmpRemainingQuotaPct(Number.NaN)).toBeNull();
  });
});

describe("OMP provider quota reset time", () => {
  test("includes the localized calendar date and time", () => {
    const result = formatOmpQuotaResetTime("2026-06-15T11:03:00.000Z", "zh-CN");

    expect(result).toContain("2026");
    expect(result).toContain("6");
    expect(result).toContain("15");
  });

  test.each([null, undefined, "", "not-a-date"])("omits invalid reset time %s", (value) => {
    expect(formatOmpQuotaResetTime(value, "zh-CN")).toBeNull();
  });
});

describe("OMP provider quota windows", () => {
  test.each(["pro", " PRO ", "Pro"])("hides the five-hour window for %s plans", (planLabel) => {
    expect(shouldShowOmpFiveHourQuota(planLabel)).toBe(false);
  });

  test.each(["plus", "team", null, undefined])(
    "keeps the five-hour window for %s plans",
    (planLabel) => {
      expect(shouldShowOmpFiveHourQuota(planLabel)).toBe(true);
    },
  );
});

import { describe, expect, test } from "vitest";
import { resolveOmpRemainingQuotaPct } from "./omp-provider-quota";

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

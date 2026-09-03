import { describe, expect, it } from "vitest";
import { calculateOutputTokenSpeed, formatOutputTokenSpeed } from "./token-output-speed";

describe("calculateOutputTokenSpeed", () => {
  it("calculates output token throughput between cumulative samples", () => {
    expect(
      calculateOutputTokenSpeed(
        { outputTokens: 120, sampledAtMs: 1_000 },
        { outputTokens: 180, sampledAtMs: 4_000 },
      ),
    ).toBe(20);
  });

  it("rejects samples without forward time and token progress", () => {
    expect(
      calculateOutputTokenSpeed(
        { outputTokens: 120, sampledAtMs: 1_000 },
        { outputTokens: 120, sampledAtMs: 4_000 },
      ),
    ).toBeNull();
    expect(
      calculateOutputTokenSpeed(
        { outputTokens: 120, sampledAtMs: 4_000 },
        { outputTokens: 180, sampledAtMs: 4_000 },
      ),
    ).toBeNull();
    expect(
      calculateOutputTokenSpeed(
        { outputTokens: 120, sampledAtMs: 1_000 },
        { outputTokens: 20, sampledAtMs: 4_000 },
      ),
    ).toBeNull();
  });
});

describe("formatOutputTokenSpeed", () => {
  it("keeps one decimal below 100 t/s and rounds faster output", () => {
    expect(formatOutputTokenSpeed(12.345)).toBe("12.3");
    expect(formatOutputTokenSpeed(123.45)).toBe("123");
  });
});

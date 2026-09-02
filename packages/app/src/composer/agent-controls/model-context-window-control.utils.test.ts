import { describe, expect, it } from "vitest";
import {
  formatContextWindowInput,
  parseContextWindowInput,
} from "./model-context-window-control.utils";

describe("context window k-unit input", () => {
  it("displays stored token overrides in thousands", () => {
    expect(formatContextWindowInput(128_000)).toBe("128");
    expect(formatContextWindowInput(131_072)).toBe("131.072");
    expect(formatContextWindowInput(null)).toBe("");
  });

  it("converts whole and decimal k values back to tokens", () => {
    expect(parseContextWindowInput("128")).toBe(128_000);
    expect(parseContextWindowInput(" 131.072 ")).toBe(131_072);
  });

  it("rejects values that cannot represent a positive whole token count", () => {
    expect(parseContextWindowInput("0")).toBeNull();
    expect(parseContextWindowInput("0.0001")).toBeNull();
    expect(parseContextWindowInput("128k")).toBeNull();
    expect(parseContextWindowInput("")).toBeNull();
  });
});

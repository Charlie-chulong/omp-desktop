import { describe, expect, it } from "vitest";
import {
  WEB_SCROLLBAR_ACTIVE_OPACITY,
  WEB_SCROLLBAR_HOVER_OPACITY,
  webScrollbarThumbColor,
} from "./web-scrollbar";

describe("web scrollbar color", () => {
  it("matches the terminal scrollbar interaction opacities", () => {
    expect(webScrollbarThumbColor("gray")).toBe("color-mix(in srgb, gray 20%, transparent)");
    expect(webScrollbarThumbColor("gray", WEB_SCROLLBAR_HOVER_OPACITY)).toBe(
      "color-mix(in srgb, gray 40%, transparent)",
    );
    expect(webScrollbarThumbColor("gray", WEB_SCROLLBAR_ACTIVE_OPACITY)).toBe(
      "color-mix(in srgb, gray 50%, transparent)",
    );
  });
});

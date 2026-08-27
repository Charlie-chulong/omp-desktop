import { describe, expect, it } from "vitest";

import { normalizeImageGenerationBaseUrl } from "./base-url.js";

describe("normalizeImageGenerationBaseUrl", () => {
  it("keeps provider path prefixes while removing trailing slashes", () => {
    expect(normalizeImageGenerationBaseUrl(" https://codex.mintcat.work/ ")).toBe(
      "https://codex.mintcat.work",
    );
    expect(normalizeImageGenerationBaseUrl("https://api.example.test/v1///")).toBe(
      "https://api.example.test/v1",
    );
  });

  it("rejects unsupported or ambiguous endpoint URLs", () => {
    expect(() => normalizeImageGenerationBaseUrl("not a url")).toThrow("valid HTTP or HTTPS");
    expect(() => normalizeImageGenerationBaseUrl("file:///tmp/api")).toThrow("HTTP or HTTPS");
    expect(() => normalizeImageGenerationBaseUrl("https://key@example.test/v1")).toThrow(
      "must not contain credentials",
    );
    expect(() => normalizeImageGenerationBaseUrl("https://example.test/v1?key=value")).toThrow(
      "query string or fragment",
    );
  });
});

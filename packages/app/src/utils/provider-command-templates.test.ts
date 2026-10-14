import { describe, expect, test } from "vitest";

import { buildProviderCommand } from "@/utils/provider-command-templates";

describe("buildProviderCommand", () => {
  test("builds OMP resume commands from native session ids", () => {
    expect(
      buildProviderCommand({
        provider: "omp",
        id: "resume",
        sessionId: "ses_abc123",
      }),
    ).toBe("omp --session ses_abc123");
  });

  test("returns null for providers without a resume template", () => {
    expect(
      buildProviderCommand({
        provider: "opencode",
        id: "resume",
        sessionId: "ses_abc123",
      }),
    ).toBeNull();
  });
});

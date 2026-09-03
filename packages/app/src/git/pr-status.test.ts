import { describe, expect, it } from "vitest";
import type { CheckoutPrStatusResponse } from "@omp-desktop/protocol/messages";
import { normalizeCheckoutPrStatusPayload, resolvePrStatusErrorMessage } from "./pr-status";

function payload(
  overrides: Partial<CheckoutPrStatusResponse["payload"]> = {},
): CheckoutPrStatusResponse["payload"] {
  return {
    cwd: "/repo",
    status: null,
    githubFeaturesEnabled: true,
    forge: "github",
    error: null,
    requestId: "pr-status-1",
    ...overrides,
  };
}

describe("normalizeCheckoutPrStatusPayload", () => {
  it("preserves known auth states", () => {
    expect(normalizeCheckoutPrStatusPayload(payload({ authState: "cli_missing" })).authState).toBe(
      "cli_missing",
    );
  });

  it("derives auth from the legacy feature flag when authState is absent", () => {
    expect(normalizeCheckoutPrStatusPayload(payload()).authState).toBe("authenticated");
    expect(
      normalizeCheckoutPrStatusPayload(payload({ githubFeaturesEnabled: false })).authState,
    ).toBe("unauthenticated");
  });

  it("does not expose an unknown wire auth state to feature code", () => {
    expect(
      normalizeCheckoutPrStatusPayload(
        payload({ authState: "future_auth_state", githubFeaturesEnabled: false }),
      ).authState,
    ).toBe("unauthenticated");
  });
});

describe("resolvePrStatusErrorMessage", () => {
  it("replaces a forge Not Found response with repository access guidance", () => {
    expect(
      resolvePrStatusErrorMessage({
        featuresEnabled: true,
        error: { message: "Not Found" },
        repositoryAccessMessage: "Sign in with repository access.",
      }),
    ).toBe("Sign in with repository access.");
  });

  it("preserves specific errors and hides errors for disabled forge features", () => {
    expect(
      resolvePrStatusErrorMessage({
        featuresEnabled: true,
        error: { message: "API rate limit exceeded" },
        repositoryAccessMessage: "Sign in with repository access.",
      }),
    ).toBe("API rate limit exceeded");
    expect(
      resolvePrStatusErrorMessage({
        featuresEnabled: false,
        error: { message: "Not Found" },
        repositoryAccessMessage: "Sign in with repository access.",
      }),
    ).toBeNull();
  });
});

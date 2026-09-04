import { describe, expect, it } from "vitest";

import {
  CheckoutStageChangesRequestSchema,
  CheckoutStageChangesResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  SubscribeCheckoutDiffRequestSchema,
} from "./messages";

describe("checkout staging schemas", () => {
  it("accepts staged and unstaged diff comparisons", () => {
    for (const mode of ["staged", "unstaged"] as const) {
      expect(
        SubscribeCheckoutDiffRequestSchema.parse({
          type: "subscribe_checkout_diff_request",
          subscriptionId: `subscription-${mode}`,
          cwd: "/repo",
          compare: { mode },
          requestId: `request-${mode}`,
        }).compare.mode,
      ).toBe(mode);
    }
  });

  it("parses stage and unstage requests through the inbound union", () => {
    for (const operation of ["stage", "unstage"] as const) {
      const request = {
        type: "checkout.stage_changes.request" as const,
        cwd: "/repo",
        operation,
        paths: ["src/file.ts"],
        requestId: `request-${operation}`,
      };
      expect(CheckoutStageChangesRequestSchema.parse(request)).toEqual(request);
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    }
  });

  it("parses responses through the outbound union", () => {
    const response = {
      type: "checkout.stage_changes.response" as const,
      payload: {
        cwd: "/repo",
        success: true,
        error: null,
        requestId: "request-stage",
      },
    };
    expect(CheckoutStageChangesResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

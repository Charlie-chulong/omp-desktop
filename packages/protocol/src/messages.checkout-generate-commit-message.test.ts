import { describe, expect, test } from "vitest";

import {
  CheckoutGenerateCommitMessageRequestSchema,
  CheckoutGenerateCommitMessageResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("checkout.commit_message.generate schemas", () => {
  test("parses the request through its schema and the inbound union", () => {
    const request = {
      type: "checkout.commit_message.generate.request",
      cwd: "/tmp/repo",
      requestId: "generate-commit-message-1",
    } as const;

    expect(CheckoutGenerateCommitMessageRequestSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("parses successful and failed responses through the outbound union", () => {
    const success = {
      type: "checkout.commit_message.generate.response",
      payload: {
        cwd: "/tmp/repo",
        message: "Refactor the changes panel",
        error: null,
        requestId: "generate-commit-message-1",
      },
    } as const;
    const failure = {
      type: "checkout.commit_message.generate.response",
      payload: {
        cwd: "/tmp/repo",
        message: null,
        error: { code: "UNKNOWN", message: "generation failed" },
        requestId: "generate-commit-message-2",
      },
    } as const;

    expect(CheckoutGenerateCommitMessageResponseSchema.parse(success)).toEqual(success);
    expect(SessionOutboundMessageSchema.parse(success)).toEqual(success);
    expect(CheckoutGenerateCommitMessageResponseSchema.parse(failure)).toEqual(failure);
    expect(SessionOutboundMessageSchema.parse(failure)).toEqual(failure);
  });
});

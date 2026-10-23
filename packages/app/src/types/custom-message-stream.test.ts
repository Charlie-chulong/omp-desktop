import { describe, expect, it } from "vitest";
import { AgentStreamEventPayloadSchema } from "@omp-desktop/protocol/messages";
import { applyStreamEvent, reduceStreamUpdate } from "./stream";
import type { StreamItem } from "./stream";

const customMessage = {
  customType: "omp-bridge-chatpro",
  details: {
    schemaVersion: 1,
    event: "result",
    deliveryId: "request:result",
    requestId: "request",
    sessionId: "session",
    runtimeId: "runtime",
    agentId: "main",
    origin: { turnId: "old-turn" },
  },
};

describe("native custom timeline records", () => {
  it("retains full text, native identity, and metadata through wire parsing and live/canonical reduction", () => {
    const text = `\n# Full result\n\n${"原文🙂\n".repeat(40_000)}\n`;
    const event = AgentStreamEventPayloadSchema.parse({
      type: "timeline",
      provider: "omp",
      turnId: "old-turn",
      item: { type: "assistant_message", text, messageId: "native-entry", customMessage },
    });
    for (const source of ["live", "canonical"] as const) {
      const result = applyStreamEvent({
        tail: [],
        head: [],
        event,
        timestamp: new Date("2026-10-19T00:00:00Z"),
        source,
      });
      const items = [...result.tail, ...result.head];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: "assistant_message",
        text,
        messageId: "native-entry",
        turnId: "old-turn",
        customMessage,
      });
    }
  });

  it("does not merge a late result into the current assistant or finalize its active reasoning", () => {
    const timestamp = new Date("2026-10-19T00:00:00Z");
    const state: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "new-answer",
        messageId: "new-answer",
        text: "working",
        timestamp,
        turnId: "new-turn",
      },
      {
        kind: "thought",
        id: "new-reasoning",
        text: "still thinking",
        timestamp,
        turnId: "new-turn",
        status: "loading",
      },
    ];
    const next = reduceStreamUpdate(
      state,
      {
        type: "timeline",
        provider: "omp",
        turnId: "old-turn",
        item: { type: "assistant_message", text: "late result", customMessage },
      },
      timestamp,
    );
    expect(next).toHaveLength(3);
    expect(next[0]).toEqual(state[0]);
    expect(next[1]).toEqual(state[1]);
    expect(next[2]).toMatchObject({ text: "late result", turnId: "old-turn", customMessage });
    const applied = applyStreamEvent({
      tail: [],
      head: state,
      timestamp,
      event: {
        type: "timeline",
        provider: "omp",
        turnId: "old-turn",
        item: { type: "assistant_message", text: "late result", customMessage },
      },
    });
    expect(applied.head).toBe(state);
    expect(applied.changedHead).toBe(false);
    expect(applied.tail).toHaveLength(1);
    expect(applied.tail[0]).toMatchObject({
      text: "late result",
      turnId: "old-turn",
      customMessage,
    });
  });

  it("deduplicates live-to-history delivery replay but allows an explicit fresh delivery", () => {
    const timestamp = new Date("2026-10-19T00:00:00Z");
    const live = applyStreamEvent({
      tail: [],
      head: [],
      timestamp,
      event: {
        type: "timeline",
        provider: "omp",
        item: { type: "assistant_message", text: "full result", customMessage },
      },
    });
    const replay = applyStreamEvent({
      ...live,
      timestamp,
      source: "canonical",
      event: {
        type: "timeline",
        provider: "omp",
        item: {
          type: "assistant_message",
          text: "full result",
          messageId: "native-history-entry",
          customMessage,
        },
      },
    });
    expect(replay.tail).toHaveLength(1);
    expect(replay.tail[0]).toMatchObject({
      text: "full result",
      messageId: "native-history-entry",
      customMessage,
    });
    const reread = applyStreamEvent({
      ...replay,
      timestamp,
      event: {
        type: "timeline",
        provider: "omp",
        item: {
          type: "assistant_message",
          text: "full result",
          customMessage: {
            ...customMessage,
            details: { ...customMessage.details, deliveryId: "fresh-reread" },
          },
        },
      },
    });
    expect(reread.tail).toHaveLength(2);
  });

  it.each([
    { event: "progress" },
    { requestId: "another-request" },
    { nativeJobId: "another-job" },
    { sessionId: "another-session" },
    { runtimeId: "another-runtime" },
    { agentId: "another-agent" },
    { origin: { turnId: "another-turn" } },
    { resultId: "another-result" },
    { status: "another-status" },
  ])(
    "preserves a distinct validated record even when its delivery and native IDs are reused: %j",
    (details) => {
      const timestamp = new Date("2026-10-19T00:00:00Z");
      const first = applyStreamEvent({
        tail: [],
        head: [],
        timestamp,
        event: {
          type: "timeline",
          provider: "omp",
          item: {
            type: "assistant_message",
            text: "original",
            messageId: "reused-native-id",
            customMessage,
          },
        },
      });
      const second = applyStreamEvent({
        ...first,
        timestamp,
        source: "canonical",
        event: {
          type: "timeline",
          provider: "omp",
          item: {
            type: "assistant_message",
            text: "original",
            messageId: "reused-native-id",
            customMessage: { ...customMessage, details: { ...customMessage.details, ...details } },
          },
        },
      });
      expect(second.tail).toHaveLength(2);
    },
  );

  it("does not discard a changed original body using otherwise identical valid delivery metadata", () => {
    const timestamp = new Date("2026-10-19T00:00:00Z");
    const first = applyStreamEvent({
      tail: [],
      head: [],
      timestamp,
      event: {
        type: "timeline",
        provider: "omp",
        item: { type: "assistant_message", text: "first original", customMessage },
      },
    });
    const second = applyStreamEvent({
      ...first,
      timestamp,
      source: "canonical",
      event: {
        type: "timeline",
        provider: "omp",
        item: { type: "assistant_message", text: "second original", customMessage },
      },
    });
    expect(second.tail.map((item) => ("text" in item ? item.text : undefined))).toEqual([
      "first original",
      "second original",
    ]);
  });

  it.each([
    { ...customMessage, details: { ...customMessage.details, event: "not-a-contract-event" } },
    { ...customMessage, details: { ...customMessage.details, inputDigest: "private-field" } },
    { ...customMessage, details: { ...customMessage.details, agentId: "" } },
    { ...customMessage, customType: "unrelated-plugin" },
  ])(
    "does not hide distinct native records using invalid or foreign delivery metadata: %j",
    (metadata) => {
      const timestamp = new Date("2026-10-19T00:00:00Z");
      const first = applyStreamEvent({
        tail: [],
        head: [],
        timestamp,
        event: {
          type: "timeline",
          provider: "omp",
          item: { type: "assistant_message", text: "first original", customMessage: metadata },
        },
      });
      const second = applyStreamEvent({
        ...first,
        timestamp,
        source: "canonical",
        event: {
          type: "timeline",
          provider: "omp",
          item: {
            type: "assistant_message",
            text: "second original",
            messageId: "second-native-entry",
            customMessage: metadata,
          },
        },
      });
      expect(second.tail.map((item) => ("text" in item ? item.text : undefined))).toEqual([
        "first original",
        "second original",
      ]);
    },
  );

  it("keeps a detached custom result detached and separate from ordinary idless assistant text", () => {
    const timestamp = new Date("2026-10-19T00:00:00Z");
    const first = reduceStreamUpdate(
      [],
      {
        type: "timeline",
        provider: "omp",
        turnId: "new-turn",
        item: { type: "assistant_message", text: "normal model" },
      },
      timestamp,
    );
    const second = reduceStreamUpdate(
      first,
      {
        type: "timeline",
        provider: "omp",
        item: { type: "assistant_message", text: "detached result", customMessage },
      },
      timestamp,
    );
    const third = reduceStreamUpdate(
      second,
      {
        type: "timeline",
        provider: "omp",
        turnId: "new-turn",
        item: { type: "assistant_message", text: "continued model" },
      },
      timestamp,
    );
    expect(third.map((item) => ("text" in item ? item.text : undefined))).toEqual([
      "normal model",
      "detached result",
      "continued model",
    ]);
    expect(third.map((item) => item.turnId)).toEqual(["new-turn", undefined, "new-turn"]);
  });
});

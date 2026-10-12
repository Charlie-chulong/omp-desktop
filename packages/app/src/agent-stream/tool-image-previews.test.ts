import { describe, expect, it } from "vitest";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { collectDuplicateToolImagePreviewIds } from "./tool-image-previews";

const timestamp = new Date(0);
const generatedSource = "/blobs/generated-images/cat.png";

function image(
  id: string,
  name: "generate_image" | "present_image",
  source = generatedSource,
  turnId?: string,
  status: "running" | "completed" | "failed" = "completed",
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    turnId,
    timestamp,
    payload: {
      source: "agent",
      data: {
        provider: "omp",
        callId: id,
        name,
        status,
        error: status === "failed" ? "Failed" : null,
        detail: {
          type: "plain_text",
          preview: { type: "image", source },
        },
      },
    },
  };
}

function user(id: string, turnId?: string): StreamItem {
  return { kind: "user_message", id, turnId, text: id, timestamp };
}

describe("tool image previews", () => {
  it("retains the generated image when a later publication repeats it across a live-head boundary", () => {
    const tail: StreamItem[] = [
      user("prompt", "turn-1"),
      image("generated", "generate_image", generatedSource, "turn-1"),
    ];
    const head: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "message",
        turnId: "turn-1",
        text: "Here is the image",
        timestamp,
      },
      image("published", "present_image", generatedSource, "turn-1"),
    ];

    expect([...collectDuplicateToolImagePreviewIds([...tail, ...head])]).toEqual(["published"]);
  });

  it("keeps standalone generation, standalone publication, and different images visible", () => {
    expect([
      ...collectDuplicateToolImagePreviewIds([image("generated", "generate_image")]),
    ]).toEqual([]);
    expect([...collectDuplicateToolImagePreviewIds([image("published", "present_image")])]).toEqual(
      [],
    );
    expect([
      ...collectDuplicateToolImagePreviewIds([
        image("generated", "generate_image"),
        image("different", "present_image", "/blobs/generated-images/dog.png"),
      ]),
    ]).toEqual([]);
  });

  it.each(["running", "failed"] as const)(
    "does not let a %s result hide a completed preview",
    (status) => {
      expect([
        ...collectDuplicateToolImagePreviewIds([
          image("unfinished", "generate_image", generatedSource, "turn-1", status),
          image("published", "present_image", generatedSource, "turn-1"),
        ]),
      ]).toEqual([]);
    },
  );

  it("allows the same image to be shown again in a new canonical turn", () => {
    expect([
      ...collectDuplicateToolImagePreviewIds([
        image("generated", "generate_image", generatedSource, "turn-1"),
        image("published", "present_image", generatedSource, "turn-2"),
      ]),
    ]).toEqual([]);
  });

  it("uses a new user message as the boundary when historical rows have no turn IDs", () => {
    expect([
      ...collectDuplicateToolImagePreviewIds([
        image("generated", "generate_image"),
        user("new-prompt"),
        image("published", "present_image"),
      ]),
    ]).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { AgentFeature } from "@omp-desktop/protocol/agent-types";
import { partitionModelFeatures } from "./utils";

describe("model settings feature partition", () => {
  it("moves fast mode into model settings without dropping or reordering other controls", () => {
    const features: AgentFeature[] = [
      {
        id: "web_search",
        label: "Web search",
        type: "toggle",
        value: true,
      },
      {
        id: "fast_mode",
        label: "Fast mode",
        description: "Lower latency",
        type: "toggle",
        value: false,
      },
      {
        id: "approval_policy",
        label: "Approval policy",
        type: "select",
        value: "ask",
        options: [{ id: "ask", label: "Ask" }],
      },
    ];

    const partitioned = partitionModelFeatures(features);

    expect(partitioned.fastMode).toBe(features[1]);
    expect(partitioned.remaining).toEqual([features[0], features[2]]);
  });

  it("leaves ordinary controls untouched when fast mode is unavailable", () => {
    const features: AgentFeature[] = [
      { id: "web_search", label: "Web search", type: "toggle", value: false },
    ];

    expect(partitionModelFeatures(features)).toEqual({
      fastMode: null,
      remaining: features,
    });
  });
});

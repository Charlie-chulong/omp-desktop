import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { GeneratedImage, ImageGenerationService } from "../../image-generation/types.js";
import type { PaseoToolResult } from "./types.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

function createCatalog(imageGenerationService: ImageGenerationService, callerAgentId = "agent-1") {
  return createPaseoToolCatalog({
    agentManager: {} as AgentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    imageGenerationService,
    callerAgentId,
    logger: pino({ level: "silent" }),
  });
}

describe("image_gen Paseo tool", () => {
  it("generates one image for the caller and returns model-visible metadata", async () => {
    const generate = vi.fn(async () => ({
      prompt: "a red fox",
      model: "gpt-image-2",
      filePath: "/tmp/generated.png",
      mimeType: "image/png",
      size: "1024x1024" as const,
      quality: "high" as const,
      background: "opaque" as const,
      outputFormat: "png" as const,
    }));
    const signal = new AbortController().signal;
    const catalog = createCatalog({ generate });

    const result = await catalog.executeTool(
      "image_gen",
      {
        prompt: "a red fox",
        size: "1024x1024",
        quality: "high",
        background: "opaque",
        outputFormat: "png",
      },
      { signal },
    );

    expect(generate).toHaveBeenCalledWith(
      {
        prompt: "a red fox",
        size: "1024x1024",
        quality: "high",
        background: "opaque",
        outputFormat: "png",
      },
      { agentId: "agent-1", signal },
    );
    expect(result.structuredContent).toMatchObject({
      filePath: "/tmp/generated.png",
      mimeType: "image/png",
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Generated image saved to /tmp/generated.png. The desktop renders it automatically.",
      },
    ]);
  });

  it("uses medium quality by default and reports provider wait progress", async () => {
    vi.useFakeTimers();
    try {
      const pending = Promise.withResolvers<GeneratedImage>();
      const generate = vi.fn(() => pending.promise);
      const updates: PaseoToolResult[] = [];
      const catalog = createCatalog({ generate });
      const resultPromise = catalog.executeTool(
        "image_gen",
        { prompt: "a red fox" },
        {
          sendUpdate: (update) => {
            updates.push(update);
          },
        },
      );

      await vi.advanceTimersByTimeAsync(15_000);
      expect(generate).toHaveBeenCalledWith(
        {
          prompt: "a red fox",
          size: "auto",
          quality: "medium",
          background: "auto",
          outputFormat: "png",
        },
        { agentId: "agent-1", signal: undefined },
      );
      expect(updates).toHaveLength(1);
      expect(updates[0]?.structuredContent).toEqual({
        type: "image_generation_progress",
        prompt: "a red fox",
        elapsedSeconds: 15,
      });

      pending.resolve({
        prompt: "a red fox",
        model: "gpt-image-2",
        filePath: "/tmp/generated.png",
        mimeType: "image/png",
        size: "auto",
        quality: "medium",
        background: "auto",
        outputFormat: "png",
      });
      await resultPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires an agent-scoped caller", async () => {
    const generate = vi.fn();
    const catalog = createCatalog({ generate }, "");
    await expect(catalog.executeTool("image_gen", { prompt: "fox" })).rejects.toThrow(
      "agent-scoped",
    );
    expect(generate).not.toHaveBeenCalled();
  });
});

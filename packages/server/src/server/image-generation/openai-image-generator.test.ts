import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImageGenerationRuntimeConfig } from "../daemon-config-store.js";
import { OpenAIImageGenerationService } from "./openai-image-generator.js";

const roots: string[] = [];
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function runtimeConfig(
  overrides: Partial<ImageGenerationRuntimeConfig> = {},
): ImageGenerationRuntimeConfig {
  return {
    enabled: true,
    provider: "openai",
    model: "gpt-image-2",
    apiKey: "test-key",
    apiKeyConfigured: true,
    apiKeySource: "config",
    ...overrides,
  };
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-image-generation-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenAIImageGenerationService", () => {
  it("writes one validated image and forwards generation controls", async () => {
    const paseoHome = await createRoot();
    const generate = vi.fn(async () => ({
      created: 1,
      data: [{ b64_json: PNG_BYTES.toString("base64"), revised_prompt: "revised" }],
    }));
    const service = new OpenAIImageGenerationService({
      paseoHome,
      getConfig: () => runtimeConfig(),
      logger: pino({ level: "silent" }),
      createClient: () => ({ generate }),
    });

    const result = await service.generate(
      {
        prompt: "  a red fox  ",
        size: "1536x1024",
        quality: "high",
        background: "opaque",
        outputFormat: "png",
      },
      { agentId: "agent/../../unsafe" },
    );

    expect(generate).toHaveBeenCalledWith(
      {
        prompt: "a red fox",
        model: "gpt-image-2",
        n: 1,
        size: "1536x1024",
        quality: "high",
        background: "opaque",
        output_format: "png",
        stream: false,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(result).toMatchObject({
      prompt: "a red fox",
      model: "gpt-image-2",
      mimeType: "image/png",
      revisedPrompt: "revised",
    });
    expect(await readFile(result.filePath)).toEqual(PNG_BYTES);
    expect(result.filePath.startsWith(path.join(paseoHome, "generated-images"))).toBe(true);
    expect(result.filePath).not.toContain("unsafe");
  });

  it("fails before networking when disabled or missing credentials", async () => {
    const paseoHome = await createRoot();
    const generate = vi.fn();
    const disabled = new OpenAIImageGenerationService({
      paseoHome,
      getConfig: () => runtimeConfig({ enabled: false }),
      logger: pino({ level: "silent" }),
      createClient: () => ({ generate }),
    });
    await expect(disabled.generate({ prompt: "fox" }, { agentId: "agent" })).rejects.toThrow(
      "disabled",
    );

    const missingKey = new OpenAIImageGenerationService({
      paseoHome,
      getConfig: () => runtimeConfig({ apiKey: undefined, apiKeyConfigured: false }),
      logger: pino({ level: "silent" }),
      createClient: () => ({ generate }),
    });
    await expect(missingKey.generate({ prompt: "fox" }, { agentId: "agent" })).rejects.toThrow(
      "API key",
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects invalid image bytes without leaving an output file", async () => {
    const paseoHome = await createRoot();
    const service = new OpenAIImageGenerationService({
      paseoHome,
      getConfig: () => runtimeConfig(),
      logger: pino({ level: "silent" }),
      createClient: () => ({
        generate: async () => ({
          created: 1,
          data: [{ b64_json: Buffer.from("not png").toString("base64") }],
        }),
      }),
    });

    await expect(service.generate({ prompt: "fox" }, { agentId: "agent" })).rejects.toThrow(
      "not valid png",
    );
    const generatedRoot = path.join(paseoHome, "generated-images");
    await expect(readdir(generatedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsupported transparent output before networking", async () => {
    const paseoHome = await createRoot();
    const generate = vi.fn();
    const service = new OpenAIImageGenerationService({
      paseoHome,
      getConfig: () => runtimeConfig(),
      logger: pino({ level: "silent" }),
      createClient: () => ({ generate }),
    });

    await expect(
      service.generate(
        { prompt: "fox", background: "transparent", outputFormat: "png" },
        { agentId: "agent" },
      ),
    ).rejects.toThrow("does not support transparent backgrounds");
    expect(generate).not.toHaveBeenCalled();
  });

  it("aborts a stalled provider request at the configured deadline", async () => {
    const paseoHome = await createRoot();
    const service = new OpenAIImageGenerationService({
      paseoHome,
      getConfig: () => runtimeConfig({ baseUrl: "https://images.example/v1" }),
      logger: pino({ level: "silent" }),
      requestTimeoutMs: 10,
      createClient: () => ({
        generate: (_input, options) => {
          const { promise, reject } = Promise.withResolvers<never>();
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
          return promise;
        },
      }),
    });

    await expect(service.generate({ prompt: "fox" }, { agentId: "agent" })).rejects.toThrow(
      "timed out",
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverOmpProviderModels } from "./omp-model-discovery.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverOmpProviderModels", () => {
  it("loads an OpenAI-compatible model list from the versioned endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "gpt-5.6-sol",
              display_name: "GPT 5.6 Sol",
              supported_apis: ["openai-responses", "anthropic-messages", "unsupported"],
              input_modalities: ["text", "image"],
              context_window: 200_000,
              max_output_tokens: 32_000,
              reasoning: true,
              default_reasoning_level: "medium",
              supported_reasoning_levels: ["low", "medium", "high"],
            },
            { id: "gpt-5.6-luna" },
            { id: "gpt-5.6-sol", display_name: "Duplicate" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverOmpProviderModels({ baseUrl: "https://api.example.test", apiKey: "secret" }),
    ).resolves.toEqual([
      {
        id: "gpt-5.6-sol",
        name: "GPT 5.6 Sol",
        supportedApis: ["openai-responses", "anthropic-messages"],
        inputModalities: ["text", "image"],
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        reasoning: true,
        defaultReasoningLevel: "medium",
        supportedReasoningLevels: ["low", "medium", "high"],
      },
      { id: "gpt-5.6-luna", name: "gpt-5.6-luna" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.example.test/v2/models"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("does not append a second version segment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "model-1" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await discoverOmpProviderModels({
      baseUrl: "https://api.example.test/v1/",
      apiKey: "secret",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL("https://api.example.test/v2/models"));
  });

  it("normalizes a v2 base URL and falls back only after a 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "model-1" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await discoverOmpProviderModels({
      baseUrl: "https://api.example.test/v2/",
      apiKey: "secret",
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/v2/models",
      "https://api.example.test/v1/models",
    ]);
  });

  it("does not hide an invalid v2 response by falling back to v1", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverOmpProviderModels({
        baseUrl: "https://api.example.test",
        apiKey: "secret",
      }),
    ).rejects.toThrow("Model endpoint did not return JSON");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an HTML v2 response as an unsupported endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<!doctype html><title>Sub2API</title>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "model-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverOmpProviderModels({
        baseUrl: "https://api.example.test",
        apiKey: "secret",
      }),
    ).resolves.toEqual([{ id: "model-1", name: "model-1" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/v2/models",
      "https://api.example.test/v1/models",
    ]);
  });

  it("falls back to a direct models endpoint after a versioned 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ id: "model-1", name: "Model One" }] }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverOmpProviderModels({
        baseUrl: "https://api.example.test/custom",
        apiKey: "secret",
      }),
    ).resolves.toEqual([{ id: "model-1", name: "Model One" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/custom/v2/models",
      "https://api.example.test/custom/v1/models",
      "https://api.example.test/custom/models",
    ]);
  });
});

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
            { id: "gpt-5.6-sol", display_name: "GPT 5.6 Sol" },
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
      { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
      { id: "gpt-5.6-luna", name: "gpt-5.6-luna" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.example.test/v1/models"),
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

    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL("https://api.example.test/v1/models"));
  });

  it("falls back to a direct models endpoint after a versioned 404", async () => {
    const fetchMock = vi
      .fn()
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
      "https://api.example.test/custom/v1/models",
      "https://api.example.test/custom/models",
    ]);
  });
});

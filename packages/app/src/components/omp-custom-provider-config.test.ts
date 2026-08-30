import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  configureDiscoveredProviderModels,
  parseCustomProviderDraft,
  updateCustomProviderConfigYaml,
  updateOmpModelContextWindowOverrides,
} from "./omp-custom-provider-config";

const configYaml = `# Keep this comment
providers:
  mintcat:
    baseUrl: https://old.example.com/v1
    apiKey: old-key
    api: openai-responses
    auth: apiKey
    models:
      - id: gpt-old
        name: GPT Old
        api: openai-responses
        input: [text, image]
        contextWindow: 128000
        maxTokens: 8192
  untouched:
    baseUrl: https://untouched.example.com/v1
    apiKey: untouched-key
    api: openai-responses
    models: []
`;

describe("OMP custom provider editing", () => {
  it("prefills provider and model fields from models.yml", () => {
    expect(parseCustomProviderDraft(configYaml, "mintcat")).toEqual({
      providerId: "mintcat",
      baseUrl: "https://old.example.com/v1",
      apiKey: "old-key",
      api: "openai-responses",
      models: [
        {
          key: "model-0",
          id: "gpt-old",
          name: "GPT Old",
          contextWindow: "128000",
          maxTokens: "8192",
          supportsImages: true,
        },
      ],
    });
  });

  it("updates only the selected provider and preserves comments and siblings", () => {
    const updated = updateCustomProviderConfigYaml(configYaml, "mintcat", {
      providerId: "mintcat",
      baseUrl: "https://new.example.com/v1",
      apiKey: "new-key",
      api: "anthropic-messages",
      models: [{ id: "claude-new", name: "Claude New", contextWindow: 200000 }],
    });
    const parsed = parse(updated) as {
      providers: Record<string, { baseUrl: string; apiKey: string; models: Array<{ id: string }> }>;
    };

    expect(updated).toContain("# Keep this comment");
    expect(parsed.providers.mintcat).toMatchObject({
      baseUrl: "https://new.example.com/v1",
      apiKey: "new-key",
      models: [{ id: "claude-new" }],
    });
    expect(parsed.providers.untouched).toMatchObject({
      baseUrl: "https://untouched.example.com/v1",
      apiKey: "untouched-key",
    });
  });

  it("serializes text and image input capabilities", () => {
    const updated = updateCustomProviderConfigYaml(configYaml, "mintcat", {
      providerId: "mintcat",
      baseUrl: "https://new.example.com/v1",
      apiKey: "new-key",
      api: "openai-responses",
      models: [{ id: "gpt-multimodal", supportsImages: true }, { id: "gpt-text-only" }],
    });
    const parsed = parse(updated) as {
      providers: Record<string, { models: Array<{ id: string; input: string[] }> }>;
    };

    expect(parsed.providers.mintcat?.models).toEqual([
      {
        id: "gpt-multimodal",
        name: "gpt-multimodal",
        api: "openai-responses",
        input: ["text", "image"],
      },
      {
        id: "gpt-text-only",
        name: "gpt-text-only",
        api: "openai-responses",
        input: ["text"],
      },
    ]);
  });

  it("replaces the draft list with discovered models while preserving matching metadata", () => {
    let nextKey = 2;
    const configured = configureDiscoveredProviderModels(
      [
        {
          key: "model-0",
          id: "gpt-existing",
          name: "",
          contextWindow: "128000",
          maxTokens: "8192",
          supportsImages: true,
        },
        {
          key: "model-1",
          id: "gpt-text-only",
          name: "Text Only",
          contextWindow: "",
          maxTokens: "",
          supportsImages: false,
        },
      ],
      [
        { id: "gpt-existing", name: "GPT Existing" },
        { id: "gpt-text-only", name: "GPT Text Only" },
        { id: "gpt-new", name: "GPT New" },
      ],
      () => `model-${nextKey++}`,
    );

    expect(configured).toEqual([
      {
        key: "model-0",
        id: "gpt-existing",
        name: "GPT Existing",
        contextWindow: "128000",
        maxTokens: "8192",
        supportsImages: true,
      },
      {
        key: "model-1",
        id: "gpt-text-only",
        name: "Text Only",
        contextWindow: "",
        maxTokens: "",
        supportsImages: false,
      },
      {
        key: "model-2",
        id: "gpt-new",
        name: "GPT New",
        contextWindow: "",
        maxTokens: "",
        supportsImages: true,
      },
    ]);
  });

  it("adds and removes built-in model context-window overrides without replacing siblings", () => {
    const added = updateOmpModelContextWindowOverrides(configYaml, "openai-codex", {
      "gpt-5.4": undefined,
      "gpt-5.6-sol": 1_000_000,
    });
    const parsedAdded = parse(added) as {
      providers: Record<string, { modelOverrides?: Record<string, { contextWindow: number }> }>;
    };

    expect(added).toContain("# Keep this comment");
    expect(parsedAdded.providers["openai-codex"]?.modelOverrides?.["gpt-5.6-sol"]).toEqual({
      contextWindow: 1_000_000,
    });
    expect(parsedAdded.providers.mintcat).toBeDefined();

    const removed = updateOmpModelContextWindowOverrides(added, "openai-codex", {
      "gpt-5.6-sol": undefined,
    });
    const parsedRemoved = parse(removed) as {
      providers: Record<string, unknown>;
    };
    expect(parsedRemoved.providers["openai-codex"]).toBeUndefined();
    expect(parsedRemoved.providers.mintcat).toBeDefined();
  });
});

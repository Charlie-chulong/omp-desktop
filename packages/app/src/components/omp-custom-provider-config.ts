import type { OmpCustomProviderInput, OmpProviderApi } from "@omp-desktop/protocol/messages";
import { isMap, parse, parseDocument } from "yaml";

export const OMP_PROVIDER_APIS = [
  "openai-responses",
  "openai-completions",
  "openai-codex-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-gemini-cli",
  "google-vertex",
] as const satisfies readonly OmpProviderApi[];

export interface OmpProviderModelDraft {
  key: string;
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  supportsImages: boolean;
}

export interface OmpProviderDraft {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  api: OmpProviderApi;
  models: OmpProviderModelDraft[];
}

export function createEmptyProviderDraft(modelKey: string): OmpProviderDraft {
  return {
    providerId: "",
    baseUrl: "",
    apiKey: "",
    api: "openai-responses",
    models: [
      {
        key: modelKey,
        id: "",
        name: "",
        contextWindow: "",
        maxTokens: "",
        supportsImages: false,
      },
    ],
  };
}
export function configureDiscoveredProviderModels(
  current: OmpProviderModelDraft[],
  discovered: ReadonlyArray<{ id: string; name: string }>,
  createKey: () => string,
): OmpProviderModelDraft[] {
  const currentById = new Map(
    current.filter((model) => model.id.trim()).map((model) => [model.id.trim(), model]),
  );
  return discovered.map((model) => {
    const existing = currentById.get(model.id);
    return existing
      ? { ...existing, name: existing.name.trim() || model.name }
      : {
          key: createKey(),
          id: model.id,
          name: model.name,
          contextWindow: "",
          maxTokens: "",
          supportsImages: true,
        };
  });
}

export function parseCustomProviderDraft(
  configYaml: string,
  providerId: string,
): OmpProviderDraft | null {
  try {
    const root = parse(configYaml) as {
      providers?: Record<
        string,
        {
          baseUrl?: unknown;
          apiKey?: unknown;
          api?: unknown;
          models?: Array<{
            id?: unknown;
            name?: unknown;
            contextWindow?: unknown;
            maxTokens?: unknown;
            input?: unknown;
          }>;
        }
      >;
    };
    const provider = root.providers?.[providerId];
    if (!provider) return null;
    const api = OMP_PROVIDER_APIS.includes(provider.api as OmpProviderApi)
      ? (provider.api as OmpProviderApi)
      : "openai-responses";
    const models = (provider.models ?? []).flatMap((model, index) =>
      typeof model.id === "string"
        ? [
            {
              key: `model-${index}`,
              id: model.id,
              name: typeof model.name === "string" ? model.name : "",
              contextWindow:
                typeof model.contextWindow === "number" ? String(model.contextWindow) : "",
              maxTokens: typeof model.maxTokens === "number" ? String(model.maxTokens) : "",
              supportsImages: Array.isArray(model.input) && model.input.includes("image"),
            },
          ]
        : [],
    );
    return {
      providerId,
      baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "",
      apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
      api,
      models: models.length > 0 ? models : createEmptyProviderDraft("model-0").models,
    };
  } catch {
    return null;
  }
}

function providerInputToYamlValue(provider: OmpCustomProviderInput) {
  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    api: provider.api,
    auth: "apiKey",
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      api: provider.api,
      input: model.supportsImages ? ["text", "image"] : ["text"],
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    })),
  };
}

export function updateCustomProviderConfigYaml(
  configYaml: string,
  providerId: string,
  provider: OmpCustomProviderInput,
): string {
  const document = parseDocument(configYaml);
  document.setIn(["providers", providerId], providerInputToYamlValue(provider));
  return document.toString();
}

export function updateOmpModelContextWindowOverrides(
  configYaml: string,
  providerId: string,
  overrides: Readonly<Record<string, number | undefined>>,
): string {
  const document = parseDocument(configYaml);
  for (const [modelId, contextWindow] of Object.entries(overrides)) {
    const modelPath = ["providers", providerId, "modelOverrides", modelId];
    const contextPath = [...modelPath, "contextWindow"];
    if (contextWindow !== undefined) {
      document.setIn(contextPath, contextWindow);
      continue;
    }
    if (document.getIn(contextPath) === undefined) {
      continue;
    }

    document.deleteIn(contextPath);
    const modelNode = document.getIn(modelPath, true);
    if (isMap(modelNode) && modelNode.items.length === 0) {
      document.deleteIn(modelPath);
    }
  }

  const overridesPath = ["providers", providerId, "modelOverrides"];
  const overridesNode = document.getIn(overridesPath, true);
  if (isMap(overridesNode) && overridesNode.items.length === 0) {
    document.deleteIn(overridesPath);
  }
  const providerPath = ["providers", providerId];
  const providerNode = document.getIn(providerPath, true);
  if (isMap(providerNode) && providerNode.items.length === 0) {
    document.deleteIn(providerPath);
  }
  return document.toString();
}

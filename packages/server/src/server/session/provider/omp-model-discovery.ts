import { OmpProviderApiSchema, type OmpProviderApi } from "@omp-desktop/protocol/messages";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface OmpDiscoveredProviderModel {
  id: string;
  name: string;
  supportedApis?: OmpProviderApi[];
  inputModalities?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
}

interface DiscoveryInput {
  baseUrl: string;
  apiKey: string;
}

function buildModelUrls(baseUrl: string): URL[] {
  const base = new URL(baseUrl);
  base.hash = "";
  base.search = "";
  base.pathname = base.pathname.replace(/\/+$/, "");

  if (base.pathname.endsWith("/v1") || base.pathname.endsWith("/v2")) {
    const rootPath = base.pathname.slice(0, -3);
    const enhanced = new URL(base);
    enhanced.pathname = `${rootPath}/v2/models`.replace(/\/{2,}/g, "/");
    const versioned = new URL(base);
    versioned.pathname = `${rootPath}/v1/models`.replace(/\/{2,}/g, "/");
    return [enhanced, versioned];
  }

  const enhanced = new URL(base);
  enhanced.pathname = `${enhanced.pathname}/v2/models`.replace(/\/{2,}/g, "/");
  const versioned = new URL(base);
  versioned.pathname = `${versioned.pathname}/v1/models`.replace(/\/{2,}/g, "/");
  const direct = new URL(base);
  direct.pathname = `${direct.pathname}/models`.replace(/\/{2,}/g, "/");
  return [enhanced, versioned, direct];
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseModels(value: unknown): OmpDiscoveredProviderModel[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const seen = new Set<string>();
  const models: OmpDiscoveredProviderModel[] = [];

  for (const item of items) {
    const candidate =
      typeof item === "string"
        ? { id: item, name: item }
        : item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : null;
    const id = typeof candidate?.id === "string" ? candidate.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const displayName =
      candidate && "display_name" in candidate ? candidate.display_name : undefined;
    const candidateName = candidate && "name" in candidate ? candidate.name : undefined;
    const name =
      typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : typeof candidateName === "string" && candidateName.trim()
          ? candidateName.trim()
          : id;
    const supportedApis = Array.isArray(candidate?.supported_apis)
      ? [
          ...new Set(
            candidate.supported_apis.flatMap((api) => {
              const parsed = OmpProviderApiSchema.safeParse(api);
              return parsed.success ? [parsed.data] : [];
            }),
          ),
        ]
      : undefined;
    const inputModalities = Array.isArray(candidate?.input_modalities)
      ? [
          ...new Set(
            candidate.input_modalities
              .filter(
                (modality): modality is string =>
                  typeof modality === "string" &&
                  (modality.trim() === "text" || modality.trim() === "image"),
              )
              .map((modality) => modality.trim()),
          ),
        ]
      : undefined;
    const contextWindow = parsePositiveInteger(candidate?.context_window);
    const maxOutputTokens = parsePositiveInteger(candidate?.max_output_tokens);
    seen.add(id);
    models.push({
      id,
      name,
      ...(supportedApis?.length ? { supportedApis } : {}),
      ...(inputModalities?.length ? { inputModalities } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    });
  }

  return models;
}

export async function discoverOmpProviderModels(
  input: DiscoveryInput,
): Promise<OmpDiscoveredProviderModel[]> {
  const urls = buildModelUrls(input.baseUrl);
  let lastStatus: number | undefined;

  for (const url of urls) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    lastStatus = response.status;
    if (!response.ok) {
      if (response.status === 404 && url !== urls.at(-1)) continue;
      throw new Error(`Model endpoint returned HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("Model endpoint response is too large");
    }
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new Error("Model endpoint response is too large");

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      if (
        url.pathname.endsWith("/v2/models") &&
        response.headers.get("content-type")?.toLowerCase().includes("text/html")
      ) {
        continue;
      }
      if (!url.pathname.endsWith("/v2/models") && url !== urls.at(-1)) continue;
      throw new Error("Model endpoint did not return JSON");
    }
    const models = parseModels(parsed);
    if (models.length > 0) return models;
    if (url.pathname.endsWith("/v2/models")) {
      throw new Error("Model endpoint returned no models");
    }
    if (url === urls.at(-1)) throw new Error("Model endpoint returned no models");
  }

  throw new Error(`Could not discover models${lastStatus ? ` (HTTP ${lastStatus})` : ""}`);
}

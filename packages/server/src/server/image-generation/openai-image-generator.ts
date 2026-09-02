import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type pino from "pino";
import { OpenAI } from "openai";
import type { ImageGenerateParamsNonStreaming, ImagesResponse } from "openai/resources/images";

import type { ImageGenerationRuntimeConfig } from "../daemon-config-store.js";
import type { OmpSubscriptionCredentialResolver } from "./omp-subscription-credential.js";
import type {
  GeneratedImage,
  ImageGenerationBackground,
  ImageGenerationContext,
  ImageGenerationInput,
  ImageGenerationOutputFormat,
  ImageGenerationQuality,
  ImageGenerationService,
  ImageGenerationSize,
} from "./types.js";

const MAX_GENERATED_IMAGE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
const CODEX_IMAGE_GENERATION_ENDPOINT = "https://chatgpt.com/backend-api/codex/images/generations";
const CODEX_IMAGE_GENERATION_MODEL = "gpt-image-2";

const MIME_TYPE_BY_OUTPUT_FORMAT: Record<ImageGenerationOutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

interface ImageApiClient {
  generate(
    input: ImageGenerateParamsNonStreaming,
    options: { signal?: AbortSignal },
  ): Promise<ImagesResponse>;
}

interface OpenAIImageGenerationDependencies {
  paseoHome: string;
  getConfig: () => ImageGenerationRuntimeConfig | null;
  logger: pino.Logger;
  createClient?: (config: ImageGenerationRuntimeConfig) => ImageApiClient;
  subscriptionCredentialResolver?: OmpSubscriptionCredentialResolver;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}

function createOpenAIImageClient(config: ImageGenerationRuntimeConfig): ImageApiClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
  return {
    generate: (input, options) => client.images.generate(input, options),
  };
}

interface RequestSignal {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
}

function createRequestSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Image generation request timed out"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function validateRequest(
  backend: ImageGenerationRuntimeConfig["backend"],
  model: string,
  input: ImageGenerationInput,
): void {
  if (!input.prompt.trim()) {
    throw new Error("Image generation prompt must not be empty.");
  }
  if (
    backend === "openai-api" &&
    (model === "gpt-image-2" || model.startsWith("gpt-image-2-")) &&
    input.background === "transparent"
  ) {
    throw new Error(`${model} does not support transparent backgrounds; use auto or opaque.`);
  }
  if (input.background === "transparent" && input.outputFormat === "jpeg") {
    throw new Error("Transparent image generation requires png or webp output.");
  }
  if (backend === "chatgpt-subscription" && input.outputFormat !== "png") {
    throw new Error("ChatGPT subscription image generation currently supports PNG output only.");
  }
}

function decodeBase64Image(value: string): Buffer {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Image generation returned invalid base64 data.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedSize = (value.length / 4) * 3 - padding;
  if (decodedSize > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("Generated image exceeds the 32 MiB output limit.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length !== decodedSize) {
    throw new Error("Image generation returned invalid base64 data.");
  }
  return bytes;
}

function hasExpectedSignature(bytes: Buffer, format: ImageGenerationOutputFormat): boolean {
  if (format === "png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (format === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function outputDirectory(paseoHome: string, agentId: string): string {
  const agentKey = createHash("sha256").update(agentId).digest("hex").slice(0, 20);
  return path.join(paseoHome, "generated-images", agentKey);
}
function subscriptionErrorMessage(status: number, body: string): string {
  let providerMessage = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const error = (parsed as Record<string, unknown>).error;
      if (typeof error === "object" && error !== null && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === "string") providerMessage = message.trim();
      } else if (typeof error === "string") {
        providerMessage = error.trim();
      }
    }
  } catch {
    providerMessage = "";
  }
  if (status === 429) {
    return providerMessage
      ? `ChatGPT subscription image generation limit reached: ${providerMessage}`
      : "ChatGPT subscription image generation limit reached.";
  }
  const suffix = providerMessage ? `: ${providerMessage}` : "";
  return `ChatGPT subscription image generation failed (HTTP ${status})${suffix}`;
}

function parseSubscriptionResponse(value: unknown): ImagesResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ChatGPT subscription image generation returned an invalid response.");
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new Error("ChatGPT subscription image generation returned an invalid response.");
  }
  const images = data.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const encoded = (item as Record<string, unknown>).b64_json;
    return typeof encoded === "string" ? [{ b64_json: encoded }] : [];
  });
  return {
    created:
      typeof (value as Record<string, unknown>).created === "number"
        ? (value as Record<string, number>).created
        : 0,
    data: images,
  };
}

export class OpenAIImageGenerationService implements ImageGenerationService {
  private readonly paseoHome: string;
  private readonly getConfig: () => ImageGenerationRuntimeConfig | null;
  private readonly logger: pino.Logger;
  private readonly createClient: (config: ImageGenerationRuntimeConfig) => ImageApiClient;
  private readonly subscriptionCredentialResolver?: OmpSubscriptionCredentialResolver;
  private readonly fetchApi: typeof fetch;
  private readonly requestTimeoutMs: number;

  public constructor(dependencies: OpenAIImageGenerationDependencies) {
    this.paseoHome = dependencies.paseoHome;
    this.getConfig = dependencies.getConfig;
    this.logger = dependencies.logger.child({ component: "image-generation", provider: "openai" });
    this.createClient = dependencies.createClient ?? createOpenAIImageClient;
    this.subscriptionCredentialResolver = dependencies.subscriptionCredentialResolver;
    this.fetchApi = dependencies.fetch ?? fetch;
    this.requestTimeoutMs = dependencies.requestTimeoutMs ?? DEFAULT_IMAGE_GENERATION_TIMEOUT_MS;
  }
  private async generateWithSubscription(
    config: ImageGenerationRuntimeConfig,
    input: {
      prompt: string;
      size: ImageGenerationSize;
      quality: ImageGenerationQuality;
      background: ImageGenerationBackground;
    },
    signal: AbortSignal,
  ): Promise<ImagesResponse> {
    const credentialId = config.subscriptionCredentialId;
    if (!credentialId) {
      throw new Error("Image generation requires an OpenAI Codex subscription account.");
    }
    if (!this.subscriptionCredentialResolver) {
      throw new Error("OpenAI Codex subscription credentials are unavailable on this host.");
    }

    const request = async (forceRefresh: boolean): Promise<Response> => {
      const credential = await this.subscriptionCredentialResolver?.resolve(credentialId, {
        forceRefresh,
        signal,
      });
      if (!credential) {
        throw new Error("OpenAI Codex subscription credentials are unavailable on this host.");
      }
      if (credential.planType === "free") {
        throw new Error("Image generation is unavailable for the selected free ChatGPT plan.");
      }
      return await this.fetchApi(CODEX_IMAGE_GENERATION_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credential.accessToken}`,
          "ChatGPT-Account-ID": credential.accountId,
          "Content-Type": "application/json",
          "x-codex-image-turn-id": randomUUID(),
        },
        body: JSON.stringify({
          prompt: input.prompt,
          background: input.background,
          model: CODEX_IMAGE_GENERATION_MODEL,
          quality: input.quality,
          size: input.size,
        }),
        signal,
      });
    };

    let response = await request(false);
    if (response.status === 401) response = await request(true);
    if (!response.ok) {
      throw new Error(subscriptionErrorMessage(response.status, await response.text()));
    }
    return parseSubscriptionResponse(await response.json());
  }

  public async generate(
    input: ImageGenerationInput,
    context: ImageGenerationContext,
  ): Promise<GeneratedImage> {
    const config = this.getConfig();
    if (!config?.enabled) {
      throw new Error("Image generation is disabled in Host settings.");
    }

    const prompt = input.prompt.trim();
    const size: ImageGenerationSize = input.size ?? "auto";
    const quality: ImageGenerationQuality = input.quality ?? "auto";
    const background: ImageGenerationBackground = input.background ?? "auto";
    const requestedOutputFormat: ImageGenerationOutputFormat = input.outputFormat ?? "png";
    validateRequest(config.backend, config.model, {
      ...input,
      outputFormat: requestedOutputFormat,
    });
    const outputFormat: ImageGenerationOutputFormat =
      config.backend === "chatgpt-subscription" ? "png" : requestedOutputFormat;
    context.signal?.throwIfAborted();

    if (config.backend === "openai-api" && !config.apiKey) {
      throw new Error("Image generation requires an OpenAI API key in Host settings.");
    }

    const client = config.backend === "openai-api" ? this.createClient(config) : null;
    const requestStartedAt = Date.now();
    const endpoint =
      config.backend === "chatgpt-subscription"
        ? new URL(CODEX_IMAGE_GENERATION_ENDPOINT).origin
        : config.baseUrl
          ? new URL(config.baseUrl).origin
          : "https://api.openai.com";
    const requestSignal = createRequestSignal(context.signal, this.requestTimeoutMs);
    this.logger.info(
      {
        model: config.model,
        size,
        quality,
        outputFormat,
        endpoint,
        timeoutMs: this.requestTimeoutMs,
      },
      "Image generation request started",
    );
    let response: ImagesResponse;
    try {
      response =
        config.backend === "chatgpt-subscription"
          ? await this.generateWithSubscription(
              config,
              { prompt, size, quality, background },
              requestSignal.signal,
            )
          : await client!.generate(
              {
                prompt,
                model: config.model,
                n: 1,
                size,
                quality,
                background,
                output_format: outputFormat,
                stream: false,
              },
              { signal: requestSignal.signal },
            );
    } catch (error) {
      const durationMs = Date.now() - requestStartedAt;
      if (requestSignal.didTimeout()) {
        this.logger.warn(
          { model: config.model, endpoint, durationMs, timeoutMs: this.requestTimeoutMs },
          "Image generation request timed out",
        );
        throw new Error(
          `Image generation timed out after ${Math.ceil(this.requestTimeoutMs / 1000)} seconds while waiting for ${endpoint}. Try medium or low quality, or check the provider endpoint.`,
          { cause: error },
        );
      }
      this.logger.warn(
        { err: error, model: config.model, endpoint, durationMs },
        "Image generation request failed",
      );
      throw error;
    } finally {
      requestSignal.dispose();
    }
    context.signal?.throwIfAborted();

    const image = response.data?.[0];
    if (!image?.b64_json) {
      throw new Error("Image generation returned no image data.");
    }
    const bytes = decodeBase64Image(image.b64_json);
    if (!hasExpectedSignature(bytes, outputFormat)) {
      throw new Error(`Image generation returned data that is not valid ${outputFormat}.`);
    }

    const directory = outputDirectory(this.paseoHome, context.agentId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const finalPath = path.join(directory, `${id}.${outputFormat}`);
    const temporaryPath = path.join(directory, `.${id}.tmp`);
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
      context.signal?.throwIfAborted();
      await rename(temporaryPath, finalPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    this.logger.info(
      {
        model: config.model,
        size,
        quality,
        outputFormat,
        filePath: finalPath,
        durationMs: Date.now() - requestStartedAt,
      },
      "Generated image",
    );
    return {
      prompt,
      model:
        config.backend === "chatgpt-subscription" ? CODEX_IMAGE_GENERATION_MODEL : config.model,
      filePath: finalPath,
      mimeType: MIME_TYPE_BY_OUTPUT_FORMAT[outputFormat],
      size,
      quality,
      background,
      outputFormat,
      ...(image.revised_prompt ? { revisedPrompt: image.revised_prompt } : {}),
    };
  }
}

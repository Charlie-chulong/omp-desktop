import { Octokit } from "@octokit/rest";
import { isGitHubHost, parseGitRemoteLocation } from "@omp-desktop/protocol/git-remote";
import { runGitCommand } from "../utils/run-git-command.js";
import { resolveSshHostname } from "../utils/ssh-hostname.js";
import { ForgeAuthenticationError } from "./forge-cli-command.js";
import { createTimeoutFetch, GitHubAuthManager, normalizeGitHubHost } from "./github-auth.js";

const GIT_REMOTE_READ_TIMEOUT_MS = 5_000;

export class GitHubAuthenticationError extends ForgeAuthenticationError {
  readonly host: string;

  constructor(host: string, reason: string) {
    super(`GitHub authentication failed for ${host}`, { stderr: reason });
    this.name = "GitHubAuthenticationError";
    this.host = host;
  }
}

export class GitHubHostNotConfiguredError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(`GitHub Enterprise host ${host} is not configured`);
    this.name = "GitHubHostNotConfiguredError";
    this.host = host;
  }
}

export class GitHubApiError extends Error {
  readonly status: number | null;
  readonly requestId: string | null;
  readonly documentationUrl: string | null;

  constructor(input: {
    message: string;
    status?: number;
    requestId?: string;
    documentationUrl?: string;
    cause: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "GitHubApiError";
    this.status = input.status ?? null;
    this.requestId = input.requestId ?? null;
    this.documentationUrl = input.documentationUrl ?? null;
  }
}

export interface ResolvedGitHubClient {
  host: string;
  octokit: Octokit;
}

export interface GitHubClientFactoryOptions {
  auth: GitHubAuthManager;
  userAgent?: string;
}

interface CachedClient {
  token: string;
  octokit: Octokit;
}

interface GitHubRequestErrorLike {
  message?: unknown;
  status?: unknown;
  response?: {
    headers?: Record<string, string | number | undefined>;
    data?: unknown;
  };
}

export class GitHubClientFactory {
  readonly #auth: GitHubAuthManager;
  readonly #userAgent: string;
  readonly #clients = new Map<string, CachedClient>();

  constructor(options: GitHubClientFactoryOptions) {
    this.#auth = options.auth;
    this.#userAgent = options.userAgent ?? "omp-desktop";
  }

  async forCwd(cwd: string): Promise<ResolvedGitHubClient> {
    return this.forHost(await this.resolveHost(cwd));
  }

  async forHost(host: string): Promise<ResolvedGitHubClient> {
    const config = this.#auth.resolveHostConfig(host);
    if (!config) throw new GitHubHostNotConfiguredError(normalizeGitHubHost(host));
    const credential = await this.#auth.getCredential(config.host);
    if (!credential) {
      throw new GitHubAuthenticationError(
        config.host,
        `Sign in to GitHub on ${config.host} to use GitHub features`,
      );
    }

    const cached = this.#clients.get(config.host);
    if (cached?.token === credential.token) {
      return { host: config.host, octokit: cached.octokit };
    }

    const octokit = new Octokit({
      auth: credential.token,
      baseUrl: config.apiBaseUrl,
      userAgent: this.#userAgent,
      request: { fetch: createTimeoutFetch() },
    });
    octokit.hook.error("request", async (error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 401
      ) {
        this.#clients.delete(config.host);
        await this.#auth.logout(config.host).catch(() => undefined);
      }
      throw error;
    });
    this.#clients.set(config.host, { token: credential.token, octokit });
    return { host: config.host, octokit };
  }

  async resolveHost(cwd: string): Promise<string> {
    let stdout: string;
    try {
      ({ stdout } = await runGitCommand(["config", "--get", "remote.origin.url"], {
        cwd,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        timeout: GIT_REMOTE_READ_TIMEOUT_MS,
      }));
    } catch {
      return "github.com";
    }

    const location = parseGitRemoteLocation(stdout.trim());
    if (!location) return "github.com";
    let host = location.host;
    if (!isGitHubHost(host) && (location.transport === "scp" || location.transport === "ssh")) {
      host = (await resolveSshHostname(host)) ?? host;
    }
    if (isGitHubHost(host)) return "github.com";
    const normalizedHost = normalizeGitHubHost(host);
    if (!this.#auth.isConfiguredHost(normalizedHost)) {
      throw new GitHubHostNotConfiguredError(normalizedHost);
    }
    return normalizedHost;
  }

  isConfiguredHost(host: string): boolean {
    return this.#auth.isConfiguredHost(host);
  }

  isLoginConfigured(host: string): boolean {
    return this.#auth.isLoginConfigured(host);
  }

  invalidate(host?: string): void {
    if (host) {
      this.#clients.delete(normalizeGitHubHost(host));
      return;
    }
    this.#clients.clear();
  }
}

export async function callGitHub<T>(
  host: string,
  operation: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw normalizeGitHubApiError(host, operation, error);
  }
}

export function normalizeGitHubApiError(host: string, operation: string, error: unknown): Error {
  if (
    error instanceof GitHubAuthenticationError ||
    error instanceof GitHubHostNotConfiguredError ||
    error instanceof GitHubApiError
  ) {
    return error;
  }

  const candidate = isRequestErrorLike(error) ? error : null;
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  const headers = candidate?.response?.headers;
  const requestId = stringHeader(headers, "x-github-request-id");
  if (status === 401) {
    return new GitHubAuthenticationError(host, "The stored GitHub token is invalid or expired");
  }

  const responseMessage = extractResponseMessage(candidate?.response?.data);
  if (status === 403 && stringHeader(headers, "x-github-sso")) {
    return new GitHubApiError({
      message: `GitHub organization SSO authorization is required for ${operation}`,
      status,
      requestId,
      cause: error,
    });
  }
  if (status === 429 || isRateLimitResponse(status, headers)) {
    const reset = stringHeader(headers, "x-ratelimit-reset");
    const resetMessage = reset
      ? `; resets at ${new Date(Number(reset) * 1_000).toISOString()}`
      : "";
    return new GitHubApiError({
      message: `GitHub rate limit exceeded during ${operation}${resetMessage}`,
      status,
      requestId,
      cause: error,
    });
  }

  const fallbackMessage = error instanceof Error ? error.message : "Unknown GitHub API error";
  return new GitHubApiError({
    message: responseMessage ?? `GitHub ${operation} failed: ${fallbackMessage}`,
    status,
    requestId,
    documentationUrl: extractDocumentationUrl(candidate?.response?.data),
    cause: error,
  });
}

export function isGitHubAuthenticationError(error: unknown): error is GitHubAuthenticationError {
  return error instanceof GitHubAuthenticationError;
}

function isRequestErrorLike(error: unknown): error is GitHubRequestErrorLike {
  return typeof error === "object" && error !== null;
}

function stringHeader(
  headers: Record<string, string | number | undefined> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function extractResponseMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("message" in data)) return null;
  return typeof data.message === "string" && data.message.trim() ? data.message : null;
}

function extractDocumentationUrl(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("documentation_url" in data)) return undefined;
  return typeof data.documentation_url === "string" ? data.documentation_url : undefined;
}

function isRateLimitResponse(
  status: number | undefined,
  headers: Record<string, string | number | undefined> | undefined,
): boolean {
  return status === 403 && stringHeader(headers, "x-ratelimit-remaining") === "0";
}

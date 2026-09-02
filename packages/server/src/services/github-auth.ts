import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { request } from "@octokit/request";
import { Octokit } from "@octokit/rest";
import { AsyncEntry } from "@napi-rs/keyring";
import { normalizeHost } from "@omp-desktop/protocol/git-remote";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const GITHUB_CREDENTIAL_SERVICE = "omp-desktop.github";
const GITHUB_LOGIN_TIMEOUT_MS = 16 * 60 * 1_000;
const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
const GITHUB_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const GITHUB_OAUTH_SCOPES = ["repo"] as const;
export const DEFAULT_GITHUB_OAUTH_CLIENT_ID = "Iv23liUcLI6z5fu6BNnr";

export type GitHubOAuthClientType = "oauth-app" | "github-app";

interface GitHubDeviceVerification {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

const StoredCredentialFields = {
  host: z.string().min(1),
  token: z.string().min(1),
  userId: z.number().int().positive().nullable(),
  login: z.string().min(1).nullable(),
  scopes: z.array(z.string()),
};

const StoredCredentialSchema = z.discriminatedUnion("version", [
  z.object({
    version: z.literal(1),
    ...StoredCredentialFields,
  }),
  z.object({
    version: z.literal(2),
    ...StoredCredentialFields,
    tokenExpiresAt: z.string().datetime(),
    refreshToken: z.string().min(1),
    refreshTokenExpiresAt: z.string().datetime(),
  }),
]);

const RefreshedTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  refresh_token_expires_in: z.number().int().positive(),
});

export type GitHubCredential = z.infer<typeof StoredCredentialSchema>;

export interface GitHubHostAuthConfig {
  host: string;
  clientId?: string;
  clientType: GitHubOAuthClientType;
  apiBaseUrl: string;
  webBaseUrl: string;
}

export interface GitHubAuthConfig {
  githubComClientId?: string;
  githubComClientType?: GitHubOAuthClientType;
  hosts?: Record<
    string,
    {
      clientId: string;
      clientType?: GitHubOAuthClientType;
      apiBaseUrl?: string;
      webBaseUrl?: string;
    }
  >;
}

export interface GitHubCredentialStore {
  get(host: string): Promise<GitHubCredential | null>;
  set(credential: GitHubCredential): Promise<void>;
  delete(host: string): Promise<void>;
}

export interface GitHubLoginStart {
  flowId: string;
  host: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string;
}

export interface GitHubLoginResult {
  host: string;
  userId: number;
  login: string;
  scopes: string[];
}

export class GitHubAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthConfigurationError";
  }
}

export class GitHubCredentialStorageError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "GitHubCredentialStorageError";
    this.cause = cause;
  }
}

export class GitHubLoginFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubLoginFlowError";
  }
}

interface LoginFlow {
  host: string;
  controller: AbortController;
  login: Promise<GitHubLoginResult>;
  timeout: NodeJS.Timeout;
}

interface GitHubAuthManagerOptions {
  config?: GitHubAuthConfig;
  credentialStore?: GitHubCredentialStore;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export class KeyringGitHubCredentialStore implements GitHubCredentialStore {
  async get(host: string): Promise<GitHubCredential | null> {
    const normalizedHost = normalizeGitHubHost(host);
    try {
      const value = await new AsyncEntry(GITHUB_CREDENTIAL_SERVICE, normalizedHost).getPassword();
      if (!value) return null;
      return StoredCredentialSchema.parse(JSON.parse(value));
    } catch (error) {
      if (isMissingKeyringEntryError(error)) return null;
      throw new GitHubCredentialStorageError(
        `Unable to read the GitHub credential for ${normalizedHost} from the system credential store`,
        error,
      );
    }
  }

  async set(credential: GitHubCredential): Promise<void> {
    const parsed = StoredCredentialSchema.parse({
      ...credential,
      host: normalizeGitHubHost(credential.host),
    });
    try {
      await new AsyncEntry(GITHUB_CREDENTIAL_SERVICE, parsed.host).setPassword(
        JSON.stringify(parsed),
      );
    } catch (error) {
      throw new GitHubCredentialStorageError(
        `Unable to store the GitHub credential for ${parsed.host} in the system credential store`,
        error,
      );
    }
  }

  async delete(host: string): Promise<void> {
    const normalizedHost = normalizeGitHubHost(host);
    try {
      await new AsyncEntry(GITHUB_CREDENTIAL_SERVICE, normalizedHost).deleteCredential();
    } catch (error) {
      if (isMissingKeyringEntryError(error)) return;
      throw new GitHubCredentialStorageError(
        `Unable to delete the GitHub credential for ${normalizedHost} from the system credential store`,
        error,
      );
    }
  }
}

export class MemoryGitHubCredentialStore implements GitHubCredentialStore {
  readonly #credentials = new Map<string, GitHubCredential>();

  async get(host: string): Promise<GitHubCredential | null> {
    return this.#credentials.get(normalizeGitHubHost(host)) ?? null;
  }

  async set(credential: GitHubCredential): Promise<void> {
    const parsed = StoredCredentialSchema.parse({
      ...credential,
      host: normalizeGitHubHost(credential.host),
    });
    this.#credentials.set(parsed.host, parsed);
  }

  async delete(host: string): Promise<void> {
    this.#credentials.delete(normalizeGitHubHost(host));
  }
}

export class GitHubAuthManager {
  readonly #config: GitHubAuthConfig;
  readonly #credentialStore: GitHubCredentialStore;
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => number;
  readonly #flows = new Map<string, LoginFlow>();
  readonly #refreshes = new Map<string, Promise<GitHubCredential | null>>();

  constructor(options: GitHubAuthManagerOptions = {}) {
    this.#config = options.config ?? {};
    this.#credentialStore = options.credentialStore ?? new KeyringGitHubCredentialStore();
    this.#env = options.env ?? process.env;
    this.#now = options.now ?? Date.now;
  }

  resolveHostConfig(host: string): GitHubHostAuthConfig | null {
    const normalizedHost = normalizeGitHubHost(host);
    if (normalizedHost === "github.com" || normalizedHost === "ssh.github.com") {
      const clientId =
        nonEmpty(this.#env.PASEO_GITHUB_OAUTH_CLIENT_ID) ??
        this.#config.githubComClientId ??
        DEFAULT_GITHUB_OAUTH_CLIENT_ID;
      return {
        host: "github.com",
        clientId,
        clientType:
          parseClientType(this.#env.PASEO_GITHUB_OAUTH_CLIENT_TYPE) ??
          this.#config.githubComClientType ??
          inferClientType(clientId),
        apiBaseUrl: "https://api.github.com",
        webBaseUrl: "https://github.com",
      };
    }

    const configured = Object.entries(this.#config.hosts ?? {}).find(
      ([configuredHost]) => normalizeGitHubHost(configuredHost) === normalizedHost,
    )?.[1];
    if (!configured) return null;
    const apiBaseUrl = normalizeGitHubBaseUrl(
      configured.apiBaseUrl ?? `https://${normalizedHost}/api/v3`,
      normalizedHost,
      "API",
    );
    const webBaseUrl = normalizeGitHubBaseUrl(
      configured.webBaseUrl ?? `https://${normalizedHost}`,
      normalizedHost,
      "web",
    );
    return {
      host: normalizedHost,
      clientId: configured.clientId,
      clientType: configured.clientType ?? inferClientType(configured.clientId),
      apiBaseUrl,
      webBaseUrl,
    };
  }

  isConfiguredHost(host: string): boolean {
    return this.resolveHostConfig(host) !== null;
  }

  isLoginConfigured(host: string): boolean {
    return nonEmpty(this.resolveHostConfig(host)?.clientId) !== undefined;
  }

  async getCredential(host: string): Promise<GitHubCredential | null> {
    const config = this.resolveHostConfig(host);
    if (!config) return null;
    const environmentToken = this.#environmentToken(config.host);
    if (environmentToken) {
      return {
        version: 1,
        host: config.host,
        token: environmentToken,
        userId: null,
        login: null,
        scopes: [],
      };
    }

    const credential = await this.#credentialStore.get(config.host);
    if (
      !credential ||
      credential.version === 1 ||
      Date.parse(credential.tokenExpiresAt) > this.#now() + GITHUB_TOKEN_REFRESH_WINDOW_MS
    ) {
      return credential;
    }
    if (Date.parse(credential.refreshTokenExpiresAt) <= this.#now()) {
      await this.#credentialStore.delete(config.host);
      return null;
    }

    const activeRefresh = this.#refreshes.get(config.host);
    if (activeRefresh) return activeRefresh;
    const refresh = this.#refreshCredential(this.#requireLoginConfig(config.host), credential);
    this.#refreshes.set(config.host, refresh);
    try {
      return await refresh;
    } finally {
      if (this.#refreshes.get(config.host) === refresh) this.#refreshes.delete(config.host);
    }
  }

  async beginLogin(host: string): Promise<GitHubLoginStart> {
    const hostConfig = this.#requireLoginConfig(host);
    if (this.#environmentToken(hostConfig.host)) {
      throw new GitHubAuthConfigurationError(
        `GitHub authentication for ${hostConfig.host} is controlled by an environment token`,
      );
    }

    const flowId = randomUUID();
    const controller = new AbortController();
    // Promise.withResolvers is unavailable on the daemon's supported ES2023 runtime.
    let resolveStart!: (start: GitHubLoginStart) => void;
    let rejectStart!: (error: unknown) => void;
    const started = new Promise<GitHubLoginStart>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    let verificationReceived = false;
    const oauthRequest = request.defaults({
      baseUrl: hostConfig.apiBaseUrl,
      request: { fetch: createTimeoutFetch(controller.signal) },
    });
    const onVerification = (verification: GitHubDeviceVerification) => {
      verificationReceived = true;
      resolveStart(this.#toLoginStart(flowId, hostConfig, verification));
    };
    const authentication =
      hostConfig.clientType === "github-app"
        ? createOAuthDeviceAuth({
            clientType: "github-app",
            clientId: hostConfig.clientId,
            request: oauthRequest,
            onVerification,
          })({ type: "oauth" })
        : createOAuthDeviceAuth({
            clientType: "oauth-app",
            clientId: hostConfig.clientId,
            scopes: [...GITHUB_OAUTH_SCOPES],
            request: oauthRequest,
            onVerification,
          })({ type: "oauth" });

    const login = authentication
      .then(async (authentication) => {
        const user = await this.#validateToken(hostConfig, authentication.token, controller.signal);
        const scopes = "scopes" in authentication ? [...authentication.scopes] : [];
        const credential: GitHubCredential =
          "refreshToken" in authentication
            ? {
                version: 2,
                host: hostConfig.host,
                token: authentication.token,
                tokenExpiresAt: authentication.expiresAt,
                refreshToken: authentication.refreshToken,
                refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
                userId: user.id,
                login: user.login,
                scopes,
              }
            : {
                version: 1,
                host: hostConfig.host,
                token: authentication.token,
                userId: user.id,
                login: user.login,
                scopes,
              };
        await this.#credentialStore.set(credential);
        return {
          host: hostConfig.host,
          userId: user.id,
          login: user.login,
          scopes,
        };
      })
      .catch((error: unknown) => {
        const normalized = normalizeGitHubOAuthError(error, hostConfig.host);
        if (!verificationReceived) rejectStart(normalized);
        throw normalized;
      });
    void login.catch(() => undefined);

    const timeout = setTimeout(() => {
      controller.abort();
      const error = new GitHubLoginFlowError(`GitHub login for ${hostConfig.host} expired`);
      if (!verificationReceived) rejectStart(error);
      this.#flows.delete(flowId);
    }, GITHUB_LOGIN_TIMEOUT_MS);
    this.#flows.set(flowId, { host: hostConfig.host, controller, login, timeout });

    try {
      return await started;
    } catch (error) {
      this.#deleteFlow(flowId, true);
      throw error;
    }
  }

  async finishLogin(flowId: string): Promise<GitHubLoginResult> {
    const flow = this.#flows.get(flowId);
    if (!flow) throw new GitHubLoginFlowError("GitHub login flow is no longer active");
    try {
      return await flow.login;
    } finally {
      this.#deleteFlow(flowId, false);
    }
  }

  cancelLogin(flowId: string): void {
    if (!this.#flows.has(flowId)) return;
    this.#deleteFlow(flowId, true);
  }

  async logout(host: string): Promise<void> {
    const config = this.resolveHostConfig(host);
    if (!config) return;
    if (this.#environmentToken(config.host)) {
      throw new GitHubAuthConfigurationError(
        `Remove the environment token to sign out from ${config.host}`,
      );
    }
    await this.#credentialStore.delete(config.host);
  }

  dispose(): void {
    for (const flowId of this.#flows.keys()) this.#deleteFlow(flowId, true);
  }

  #requireLoginConfig(host: string): GitHubHostAuthConfig & { clientId: string } {
    const config = this.resolveHostConfig(host);
    if (!config) {
      throw new GitHubAuthConfigurationError(
        `GitHub Enterprise host ${normalizeGitHubHost(host)} is not configured`,
      );
    }
    const clientId = nonEmpty(config.clientId);
    if (!clientId) {
      throw new GitHubAuthConfigurationError(
        `GitHub OAuth is not configured for ${config.host}; configure github.clientId or set PASEO_GITHUB_OAUTH_CLIENT_ID`,
      );
    }
    return { ...config, clientId };
  }

  #toLoginStart(
    flowId: string,
    hostConfig: GitHubHostAuthConfig,
    verification: GitHubDeviceVerification,
  ): GitHubLoginStart {
    const verificationUrl = new URL(verification.verification_uri);
    if (
      verificationUrl.protocol !== "https:" ||
      normalizeGitHubHost(verificationUrl.host) !== hostConfig.host
    ) {
      throw new GitHubLoginFlowError(
        `GitHub returned an invalid device verification URL for ${hostConfig.host}`,
      );
    }
    return {
      flowId,
      host: hostConfig.host,
      verificationUri: verificationUrl.toString(),
      userCode: verification.user_code,
      expiresAt: new Date(this.#now() + verification.expires_in * 1_000).toISOString(),
    };
  }
  async #validateToken(
    hostConfig: GitHubHostAuthConfig,
    token: string,
    parentSignal: AbortSignal,
  ): Promise<{ id: number; login: string }> {
    const octokit = new Octokit({
      auth: token,
      baseUrl: hostConfig.apiBaseUrl,
      userAgent: "omp-desktop",
      request: { fetch: createTimeoutFetch(parentSignal) },
    });
    const response = await octokit.rest.users.getAuthenticated();
    return { id: response.data.id, login: response.data.login };
  }

  async #refreshCredential(
    hostConfig: GitHubHostAuthConfig & { clientId: string },
    credential: Extract<GitHubCredential, { version: 2 }>,
  ): Promise<GitHubCredential | null> {
    const response = await createTimeoutFetch()(
      new URL("/login/oauth/access_token", hostConfig.webBaseUrl),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: hostConfig.clientId,
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken,
        }),
      },
    );
    const payload: unknown = await response.json();
    if (!response.ok) {
      const code =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;
      if (code === "bad_refresh_token") {
        await this.#credentialStore.delete(hostConfig.host);
        return null;
      }
      throw new GitHubLoginFlowError(
        `Unable to refresh GitHub authentication for ${hostConfig.host}: ${code}`,
      );
    }

    const refreshed = RefreshedTokenResponseSchema.parse(payload);
    const now = this.#now();
    const updated: GitHubCredential = {
      ...credential,
      token: refreshed.access_token,
      tokenExpiresAt: new Date(now + refreshed.expires_in * 1_000).toISOString(),
      refreshToken: refreshed.refresh_token,
      refreshTokenExpiresAt: new Date(
        now + refreshed.refresh_token_expires_in * 1_000,
      ).toISOString(),
    };
    await this.#credentialStore.set(updated);
    return updated;
  }

  #environmentToken(host: string): string | null {
    if (host === "github.com") {
      return nonEmpty(this.#env.GH_TOKEN) ?? nonEmpty(this.#env.GITHUB_TOKEN) ?? null;
    }
    const configuredEnvironmentHost = nonEmpty(this.#env.GH_HOST);
    if (!configuredEnvironmentHost || normalizeGitHubHost(configuredEnvironmentHost) !== host) {
      return null;
    }
    return (
      nonEmpty(this.#env.GH_ENTERPRISE_TOKEN) ?? nonEmpty(this.#env.GITHUB_ENTERPRISE_TOKEN) ?? null
    );
  }

  #deleteFlow(flowId: string, abort: boolean): void {
    const flow = this.#flows.get(flowId);
    if (!flow) return;
    this.#flows.delete(flowId);
    clearTimeout(flow.timeout);
    if (abort) flow.controller.abort();
  }
}

export function normalizeGitHubHost(host: string): string {
  const normalized = normalizeHost(host);
  if (!normalized || !/^[a-z0-9.-]+(?::\d+)?$/.test(normalized)) {
    throw new GitHubAuthConfigurationError(`Invalid GitHub host: ${host}`);
  }
  return normalized === "ssh.github.com" ? "github.com" : normalized;
}

function normalizeGitHubBaseUrl(value: string, host: string, label: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    normalizeGitHubHost(url.host) !== host ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new GitHubAuthConfigurationError(
      `GitHub ${label} URL for ${host} must be an HTTPS URL on the same host`,
    );
  }
  return url.toString().replace(/\/$/u, "");
}

export function createTimeoutFetch(parentSignal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
    const signals = [init?.signal, parentSignal, timeoutSignal].filter(
      (signal): signal is AbortSignal => signal !== null && signal !== undefined,
    );
    return fetch(input, {
      ...init,
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    });
  };
}

function parseClientType(value: string | undefined): GitHubOAuthClientType | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "github-app" || normalized === "oauth-app" ? normalized : undefined;
}
function normalizeGitHubOAuthError(error: unknown, host: string): Error {
  const code =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "error" in error.response.data &&
    typeof error.response.data.error === "string"
      ? error.response.data.error
      : null;
  if (code === "device_flow_disabled") {
    return new GitHubAuthConfigurationError(
      `GitHub Device Flow is disabled for the App configured on ${host}; enable Device Flow in the GitHub App settings`,
    );
  }
  if (code === "incorrect_client_credentials") {
    return new GitHubAuthConfigurationError(
      `The GitHub Client ID configured for ${host} is invalid`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function inferClientType(clientId: string): GitHubOAuthClientType {
  return clientId.startsWith("I") ? "github-app" : "oauth-app";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isMissingKeyringEntryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return normalized.includes("noentry") || normalized.includes("no entry");
}

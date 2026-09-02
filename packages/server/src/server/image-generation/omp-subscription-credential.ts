import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readStoredOmpOAuthAccounts } from "../agent/providers/omp/agent.js";
import { ensureManagedOmpOnPath } from "../agent/providers/omp/installer.js";
import { resolveOmpDiagnosticPaths } from "../agent/providers/omp/provider-config.js";

const execFileAsync = promisify(execFile);
const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const TOKEN_COMMAND_TIMEOUT_MS = 30_000;
const TOKEN_COMMAND_MAX_BUFFER_BYTES = 64 * 1024;

export interface OmpSubscriptionCredential {
  accessToken: string;
  accountId: string;
  planType?: string;
}

export interface OmpSubscriptionCredentialResolveOptions {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export interface OmpSubscriptionCredentialResolver {
  resolve(
    credentialId: number,
    options?: OmpSubscriptionCredentialResolveOptions,
  ): Promise<OmpSubscriptionCredential>;
}

type RunTokenCommand = (
  accountPosition: number,
  options: OmpSubscriptionCredentialResolveOptions,
) => Promise<string>;

interface OmpSubscriptionCredentialResolverOptions {
  env?: NodeJS.ProcessEnv;
  runTokenCommand?: RunTokenCommand;
}

function parseJwtPayload(accessToken: string): Record<string, unknown> {
  const parts = accessToken.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("OMP returned an invalid OpenAI Codex OAuth token.");
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("invalid payload");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error("OMP returned an invalid OpenAI Codex OAuth token.", { cause: error });
  }
}

function parseCredential(accessToken: string): OmpSubscriptionCredential {
  const token = accessToken.trim();
  if (!token) throw new Error("OMP returned an empty OpenAI Codex OAuth token.");
  const payload = parseJwtPayload(token);
  const auth = payload[OPENAI_AUTH_CLAIM];
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
    throw new Error("OpenAI Codex OAuth token does not contain account information.");
  }
  const authClaims = auth as Record<string, unknown>;
  const accountId =
    typeof authClaims.chatgpt_account_id === "string" ? authClaims.chatgpt_account_id.trim() : "";
  if (!accountId) {
    throw new Error("OpenAI Codex OAuth token does not contain a ChatGPT account ID.");
  }
  const planType =
    typeof authClaims.chatgpt_plan_type === "string"
      ? authClaims.chatgpt_plan_type.trim().toLowerCase()
      : "";
  return {
    accessToken: token,
    accountId,
    ...(planType ? { planType } : {}),
  };
}

export class DefaultOmpSubscriptionCredentialResolver implements OmpSubscriptionCredentialResolver {
  private readonly env: NodeJS.ProcessEnv;
  private readonly runTokenCommand: RunTokenCommand;

  constructor(options: OmpSubscriptionCredentialResolverOptions = {}) {
    this.env = { ...process.env, ...options.env };
    ensureManagedOmpOnPath(process.platform, this.env);
    this.runTokenCommand =
      options.runTokenCommand ??
      (async (accountPosition, resolveOptions) => {
        const args = [
          "token",
          OPENAI_CODEX_PROVIDER,
          "--account",
          String(accountPosition),
          ...(resolveOptions.forceRefresh ? ["--force-refresh"] : []),
        ];
        const result = await execFileAsync("omp", args, {
          env: this.env,
          encoding: "utf8",
          maxBuffer: TOKEN_COMMAND_MAX_BUFFER_BYTES,
          timeout: TOKEN_COMMAND_TIMEOUT_MS,
          signal: resolveOptions.signal,
        });
        return result.stdout;
      });
  }

  async resolve(
    credentialId: number,
    options: OmpSubscriptionCredentialResolveOptions = {},
  ): Promise<OmpSubscriptionCredential> {
    if (!Number.isSafeInteger(credentialId) || credentialId <= 0) {
      throw new Error("A valid OpenAI Codex subscription account must be selected.");
    }
    const { agentDb } = resolveOmpDiagnosticPaths(this.env);
    const accounts = readStoredOmpOAuthAccounts(agentDb).filter(
      (account) => account.provider === OPENAI_CODEX_PROVIDER,
    );
    const accountPosition =
      accounts.findIndex((account) => account.credentialId === credentialId) + 1;
    if (accountPosition === 0) {
      throw new Error("The selected OpenAI Codex subscription account is no longer available.");
    }
    const accessToken = await this.runTokenCommand(accountPosition, options);
    return parseCredential(accessToken);
  }
}

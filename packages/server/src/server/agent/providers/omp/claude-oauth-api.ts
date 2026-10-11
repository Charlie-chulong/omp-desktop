import type { ClaudeAccountQuotaFetchOptions } from "./claude-account-quota.js";

export const CLAUDE_PROFILE_ENDPOINT = "https://api.anthropic.com/api/oauth/profile";
export const CLAUDE_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1";

export class ClaudeOAuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: "unavailable" | "error" = "error",
  ) {
    super(message);
  }
}

export async function requestClaudeOAuth(
  options: ClaudeAccountQuotaFetchOptions,
  endpoint: string,
  request: { resource: string; body?: Record<string, string>; timeoutMs?: number },
): Promise<unknown> {
  const accessToken = options.credential.accessToken.trim();
  if (!accessToken) {
    throw new ClaudeOAuthRequestError("Claude account credential is unavailable", "unavailable");
  }
  const controller = new AbortController();
  let rejectDeadline!: (reason: unknown) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timeout = setTimeout(
    () => {
      controller.abort();
      rejectDeadline(new ClaudeOAuthRequestError(`Claude ${request.resource} request timed out`));
    },
    request.timeoutMs ?? options.timeoutMs ?? 15_000,
  );
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const response = await (options.fetch ?? fetch)(endpoint, {
          method: request.body ? "POST" : "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "claude-cli/2.1.296 (external, cli)",
            ...(request.body ? { "Content-Type": "application/json" } : {}),
          },
          signal: controller.signal,
          cache: "no-store",
          redirect: "error",
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        });
        if (response.status === 401 || response.status === 403) {
          throw new ClaudeOAuthRequestError("Claude account authentication expired", "unavailable");
        }
        if (!response.ok) {
          throw new ClaudeOAuthRequestError(
            `Claude ${request.resource} request failed`,
            [404, 405, 501].includes(response.status) ? "unavailable" : "error",
          );
        }
        // A successful status is not confirmation. Keep the deadline through body consumption.
        const body = await response.text();
        try {
          const payload: unknown = JSON.parse(body);
          return payload;
        } catch {
          throw new ClaudeOAuthRequestError(
            `Claude ${request.resource} response was not valid JSON`,
          );
        }
      })(),
    ]);
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ClaudeOAuthRequestError(`Claude ${request.resource} request timed out`);
    }
    if (error instanceof ClaudeOAuthRequestError) throw error;
    // Network and body-reader exceptions may contain credentials or backend details.
    throw new ClaudeOAuthRequestError(`Claude ${request.resource} request failed`);
  } finally {
    clearTimeout(timeout);
  }
}

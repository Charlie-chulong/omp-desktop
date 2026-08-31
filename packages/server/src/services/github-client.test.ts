import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAuthManager, MemoryGitHubCredentialStore } from "./github-auth.js";
import {
  GitHubApiError,
  GitHubAuthenticationError,
  GitHubClientFactory,
  normalizeGitHubApiError,
} from "./github-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("normalizeGitHubApiError", () => {
  it("classifies invalid tokens as authentication failures", () => {
    const error = normalizeGitHubApiError("github.com", "repository lookup", {
      status: 401,
      response: { headers: { "x-github-request-id": "request-1" } },
    });

    expect(error).toBeInstanceOf(GitHubAuthenticationError);
    expect((error as GitHubAuthenticationError).host).toBe("github.com");
  });

  it("keeps organization SSO failures distinct from missing authentication", () => {
    const error = normalizeGitHubApiError("github.com", "repository lookup", {
      status: 403,
      response: {
        headers: {
          "x-github-sso": "required; url=https://github.com/orgs/acme/sso",
          "x-github-request-id": "request-2",
        },
      },
    });

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).not.toBeInstanceOf(GitHubAuthenticationError);
    expect((error as GitHubApiError).message).toContain("SSO authorization is required");
    expect((error as GitHubApiError).requestId).toBe("request-2");
  });

  it("reports the rate-limit reset time", () => {
    const error = normalizeGitHubApiError("github.com", "pull request status", {
      status: 403,
      response: {
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1787788800",
        },
      },
    });

    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).message).toContain("rate limit exceeded");
    expect((error as GitHubApiError).message).toContain("resets at");
  });
});

describe("GitHubClientFactory", () => {
  it("removes an invalid stored token after a 401 response", async () => {
    const store = new MemoryGitHubCredentialStore();
    await store.set({
      version: 1,
      host: "github.com",
      token: "expired-token",
      userId: 42,
      login: "octocat",
      scopes: ["repo"],
    });
    const auth = new GitHubAuthManager({
      config: { githubComClientId: "client" },
      credentialStore: store,
      env: {},
    });
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    const { octokit } = await new GitHubClientFactory({ auth }).forHost("github.com");
    await expect(octokit.rest.users.getAuthenticated()).rejects.toMatchObject({ status: 401 });
    await expect(store.get("github.com")).resolves.toBeNull();
  });
});

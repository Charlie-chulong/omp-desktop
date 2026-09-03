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

  it("keeps a rotated credential when a stale client receives a 401 response", async () => {
    const store = new MemoryGitHubCredentialStore();
    let now = Date.parse("2026-08-27T00:00:00.000Z");
    await store.set({
      version: 2,
      host: "github.com",
      token: "expiring-token",
      tokenExpiresAt: "2026-08-27T08:00:00.000Z",
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: "2027-02-27T00:00:00.000Z",
      userId: 42,
      login: "octocat",
      scopes: [],
    });
    const auth = new GitHubAuthManager({
      credentialStore: store,
      env: {},
      now: () => now,
    });
    globalThis.fetch = vi.fn(async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/login/oauth/access_token")) {
        return new Response(
          JSON.stringify({
            access_token: "refreshed-token",
            expires_in: 28_800,
            refresh_token: "rotated-refresh-token",
            refresh_token_expires_in: 15_897_600,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      const token = request.headers.get("authorization");
      return new Response(JSON.stringify({ login: "octocat" }), {
        status: token === "token expiring-token" ? 401 : 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const factory = new GitHubClientFactory({ auth });

    const stale = await factory.forHost("github.com");
    now += 8 * 60 * 60 * 1_000;
    const current = await factory.forHost("github.com");
    await expect(stale.octokit.rest.users.getAuthenticated()).rejects.toMatchObject({
      status: 401,
    });

    await expect(store.get("github.com")).resolves.toMatchObject({
      token: "refreshed-token",
      refreshToken: "rotated-refresh-token",
    });
    await expect(current.octokit.rest.users.getAuthenticated()).resolves.toMatchObject({
      data: { login: "octocat" },
    });
  });
});

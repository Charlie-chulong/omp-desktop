import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GITHUB_OAUTH_CLIENT_ID,
  GitHubAuthConfigurationError,
  GitHubAuthManager,
  MemoryGitHubCredentialStore,
} from "./github-auth.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe("GitHubAuthManager", () => {
  it("completes device authorization, validates the user, and stores a host-bound token", async () => {
    const store = new MemoryGitHubCredentialStore();
    const requests: Request[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/login/device/code")) {
        return jsonResponse({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        });
      }
      if (request.url.endsWith("/login/oauth/access_token")) {
        return jsonResponse({
          access_token: "oauth-token",
          token_type: "bearer",
          scope: "repo",
        });
      }
      if (request.url.endsWith("/user")) {
        expect(request.headers.get("authorization")).toBe("token oauth-token");
        return jsonResponse({ id: 42, login: "octocat" });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const auth = new GitHubAuthManager({
      config: { githubComClientId: "oauth-client" },
      credentialStore: store,
      env: {},
      now: () => Date.parse("2026-08-27T00:00:00.000Z"),
    });

    const start = await auth.beginLogin("github.com");
    expect(start).toEqual({
      flowId: expect.any(String),
      host: "github.com",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-27T00:15:00.000Z",
    });
    await expect(auth.finishLogin(start.flowId)).resolves.toEqual({
      host: "github.com",
      userId: 42,
      login: "octocat",
      scopes: ["repo"],
    });
    await expect(store.get("github.com")).resolves.toEqual({
      version: 1,
      host: "github.com",
      token: "oauth-token",
      userId: 42,
      login: "octocat",
      scopes: ["repo"],
    });
    expect(requests.some((request) => request.url.endsWith("/user"))).toBe(true);
  });

  it("reports when Device Flow is disabled for the configured GitHub App", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        {
          error: "device_flow_disabled",
          error_description: "Device Flow must be explicitly enabled for this App",
        },
        400,
      ),
    ) as typeof fetch;
    const auth = new GitHubAuthManager({
      credentialStore: new MemoryGitHubCredentialStore(),
      env: {},
    });

    await expect(auth.beginLogin("github.com")).rejects.toThrow(
      "enable Device Flow in the GitHub App settings",
    );
  });

  it("keeps GitHub.com and Enterprise credentials isolated", async () => {
    const store = new MemoryGitHubCredentialStore();
    await store.set({
      version: 1,
      host: "github.com",
      token: "cloud-token",
      userId: 1,
      login: "cloud-user",
      scopes: ["repo"],
    });
    await store.set({
      version: 1,
      host: "github.acme.test",
      token: "enterprise-token",
      userId: 2,
      login: "enterprise-user",
      scopes: ["repo"],
    });
    const auth = new GitHubAuthManager({
      config: {
        githubComClientId: "cloud-client",
        hosts: { "github.acme.test": { clientId: "enterprise-client" } },
      },
      credentialStore: store,
      env: {},
    });

    await expect(auth.getCredential("github.com")).resolves.toMatchObject({
      token: "cloud-token",
    });
    await expect(auth.getCredential("github.acme.test")).resolves.toMatchObject({
      token: "enterprise-token",
    });
    expect(auth.resolveHostConfig("github.acme.test")).toMatchObject({
      apiBaseUrl: "https://github.acme.test/api/v3",
      webBaseUrl: "https://github.acme.test",
    });
    expect(auth.isLoginConfigured("github.com")).toBe(true);
    expect(auth.isLoginConfigured("github.acme.test")).toBe(true);
    const defaults = new GitHubAuthManager({
      credentialStore: new MemoryGitHubCredentialStore(),
      env: {},
    });
    expect(defaults.isLoginConfigured("github.com")).toBe(true);
    expect(defaults.resolveHostConfig("github.com")).toMatchObject({
      clientId: DEFAULT_GITHUB_OAUTH_CLIENT_ID,
      clientType: "github-app",
    });
  });

  it("refuses Enterprise API URLs that could receive a token for another host", () => {
    const auth = new GitHubAuthManager({
      config: {
        hosts: {
          "github.acme.test": {
            clientId: "client",
            apiBaseUrl: "https://attacker.test/api/v3",
          },
        },
      },
      credentialStore: new MemoryGitHubCredentialStore(),
      env: {},
    });

    expect(() => auth.resolveHostConfig("github.acme.test")).toThrow(GitHubAuthConfigurationError);
  });

  it("uses environment tokens without persisting or deleting them", async () => {
    const auth = new GitHubAuthManager({
      config: { githubComClientId: "client" },
      credentialStore: new MemoryGitHubCredentialStore(),
      env: { GH_TOKEN: "environment-token" },
    });

    await expect(auth.getCredential("github.com")).resolves.toMatchObject({
      token: "environment-token",
      host: "github.com",
    });
    await expect(auth.logout("github.com")).rejects.toThrow("Remove the environment token");
    await expect(auth.beginLogin("github.com")).rejects.toThrow(
      "controlled by an environment token",
    );
  });

  it("binds enterprise environment tokens to GH_HOST", async () => {
    const config = {
      hosts: { "github.acme.test": { clientId: "enterprise-client" } },
    };
    const unbound = new GitHubAuthManager({
      config,
      credentialStore: new MemoryGitHubCredentialStore(),
      env: { GH_ENTERPRISE_TOKEN: "enterprise-token" },
    });
    const bound = new GitHubAuthManager({
      config,
      credentialStore: new MemoryGitHubCredentialStore(),
      env: {
        GH_HOST: "github.acme.test",
        GH_ENTERPRISE_TOKEN: "enterprise-token",
      },
    });

    await expect(unbound.getCredential("github.acme.test")).resolves.toBeNull();
    await expect(bound.getCredential("github.acme.test")).resolves.toMatchObject({
      token: "enterprise-token",
      host: "github.acme.test",
    });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

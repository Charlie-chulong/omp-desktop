import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAuthManager, MemoryGitHubCredentialStore } from "./github-auth.js";
import { createGitHubService } from "./github-service.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

async function createAuthenticatedService(fetch: typeof globalThis.fetch) {
  const store = new MemoryGitHubCredentialStore();
  await store.set({
    version: 1,
    host: "github.com",
    token: "token",
    userId: 1,
    login: "octocat",
    scopes: ["repo"],
  });
  globalThis.fetch = fetch;
  return createGitHubService({
    authManager: new GitHubAuthManager({
      config: { githubComClientId: "client" },
      credentialStore: store,
      env: {},
    }),
  });
}

describe("GitHub repository discovery", () => {
  it("lists repositories visible to the authenticated user without gh", async () => {
    const service = await createAuthenticatedService(
      vi.fn(async (input, init) => {
        const request = new Request(input, init);
        expect(request.url).toContain("/user/repos");
        expect(request.url).toContain("affiliation=owner%2Ccollaborator%2Corganization_member");
        return jsonResponse([
          {
            id: 1,
            name: "paseo",
            full_name: "getpaseo/paseo",
            description: "Desktop agents",
            private: false,
            visibility: "public",
            updated_at: "2026-08-27T12:00:00Z",
            clone_url: "https://github.com/getpaseo/paseo.git",
          },
        ]);
      }) as typeof fetch,
    );

    await expect(
      service.searchRepositories({ cwd: "/tmp", query: "", limit: 10 }),
    ).resolves.toEqual([
      {
        id: "1",
        name: "paseo",
        nameWithOwner: "getpaseo/paseo",
        description: "Desktop agents",
        visibility: "public",
        updatedAt: "2026-08-27T12:00:00Z",
        cloneUrl: "https://github.com/getpaseo/paseo.git",
      },
    ]);
  });

  it("uses GitHub repository search and preserves internal visibility", async () => {
    const service = await createAuthenticatedService(
      vi.fn(async (input, init) => {
        const request = new Request(input, init);
        expect(request.url).toContain("/search/repositories");
        expect(request.url).toContain("q=desktop");
        return jsonResponse({
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              id: 2,
              name: "internal",
              full_name: "acme/internal",
              description: null,
              private: true,
              visibility: "internal",
              updated_at: "2026-08-26T12:00:00Z",
              clone_url: "https://github.com/acme/internal.git",
            },
          ],
        });
      }) as typeof fetch,
    );

    await expect(
      service.searchRepositories({ cwd: "/tmp", query: "desktop", limit: 10 }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "2",
        nameWithOwner: "acme/internal",
        visibility: "internal",
      }),
    ]);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

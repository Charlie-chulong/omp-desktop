import { describe, expect, it } from "vitest";
import { GitHubAuthManager, MemoryGitHubCredentialStore } from "./github-auth.js";
import { GitHubGitCredentialEnvironmentProvider } from "./github-git-credentials.js";

async function createProvider() {
  const store = new MemoryGitHubCredentialStore();
  await store.set({
    version: 1,
    host: "github.com",
    token: "secret-token",
    userId: 42,
    login: "octocat",
    scopes: ["repo"],
  });
  const auth = new GitHubAuthManager({
    config: { githubComClientId: "client" },
    credentialStore: store,
    env: {},
  });
  return new GitHubGitCredentialEnvironmentProvider(auth);
}

describe("GitHubGitCredentialEnvironmentProvider", () => {
  it("injects a keyring-backed AskPass helper for an HTTPS GitHub clone", async () => {
    const provider = await createProvider();

    const environment = await provider.resolve({
      args: ["clone", "https://github.com/acme/repo.git", "/tmp/repo"],
      cwd: "/tmp",
    });

    expect(environment).toMatchObject({
      GIT_ASKPASS_REQUIRE: "force",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      PASEO_GITHUB_HOST: "github.com",
    });
    expect(environment).not.toHaveProperty("PASEO_GITHUB_TOKEN");
    expect(environment?.GIT_ASKPASS).toContain("github-git-askpass");
  });

  it("never offers a GitHub token to SSH or unrelated HTTPS hosts", async () => {
    const provider = await createProvider();

    await expect(
      provider.resolve({
        args: ["clone", "git@github.com:acme/repo.git", "/tmp/repo"],
        cwd: "/tmp",
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.resolve({
        args: ["clone", "https://gitlab.com/acme/repo.git", "/tmp/repo"],
        cwd: "/tmp",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not inject credentials into non-network Git commands", async () => {
    const provider = await createProvider();
    await expect(
      provider.resolve({ args: ["status", "--short"], cwd: "/tmp" }),
    ).resolves.toBeUndefined();
  });
});

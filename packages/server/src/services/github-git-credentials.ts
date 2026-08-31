import { fileURLToPath } from "node:url";
import { isGitHubHost, parseGitRemoteLocation } from "@omp-desktop/protocol/git-remote";
import type { ProcessEnvRecord } from "../server/paseo-env.js";
import { runGitCommand } from "../utils/run-git-command.js";
import type { GitCredentialEnvironmentInput } from "../utils/run-git-command.js";
import { GitHubAuthManager, normalizeGitHubHost } from "./github-auth.js";

const AUTHENTICATED_GIT_OPERATIONS: Record<string, true> = {
  clone: true,
  fetch: true,
  pull: true,
  push: true,
};

const GIT_ASKPASS_SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/github-git-askpass.mjs", import.meta.url),
);
const GIT_ASKPASS_PATH =
  process.platform === "win32"
    ? fileURLToPath(new URL("../../scripts/github-git-askpass.cmd", import.meta.url))
    : GIT_ASKPASS_SCRIPT_PATH;

export class GitHubGitCredentialEnvironmentProvider {
  readonly #auth: GitHubAuthManager;

  constructor(auth: GitHubAuthManager) {
    this.#auth = auth;
  }

  async resolve(input: GitCredentialEnvironmentInput): Promise<ProcessEnvRecord | undefined> {
    const operationIndex = findGitOperationIndex(input.args);
    const operation = input.args[operationIndex];
    if (!operation || !AUTHENTICATED_GIT_OPERATIONS[operation]) return undefined;

    const remoteUrl =
      operation === "clone"
        ? findCloneUrl(input.args.slice(operationIndex + 1))
        : await readOriginRemote(input.cwd);
    if (!remoteUrl) return undefined;
    const location = parseGitRemoteLocation(remoteUrl);
    if (!location || location.transport !== "https") return undefined;

    const host = isGitHubHost(location.host) ? "github.com" : normalizeGitHubHost(location.host);
    if (!this.#auth.isConfiguredHost(host)) return undefined;
    const credential = await this.#auth.getCredential(host);
    // Environment-owned tokens remain environment-owned. Only OAuth tokens
    // persisted in the OS credential store are exposed through the helper.
    if (!credential || credential.userId === null) return undefined;

    return {
      GIT_ASKPASS: GIT_ASKPASS_PATH,
      GIT_ASKPASS_REQUIRE: "force",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: `${GIT_ASKPASS_PATH}.no-hooks`,
      PASEO_NODE_EXECUTABLE: process.execPath,
      PASEO_GITHUB_HOST: host,
    };
  }
}

function findGitOperationIndex(args: readonly string[]): number {
  let index = 0;
  while (args[index] === "-c" && index + 2 < args.length) index += 2;
  return index;
}

function findCloneUrl(args: readonly string[]): string | null {
  for (const argument of args) {
    if (argument.startsWith("-")) continue;
    return parseGitRemoteLocation(argument) ? argument : null;
  }
  return null;
}

async function readOriginRemote(cwd: string): Promise<string | null> {
  try {
    const result = await runGitCommand(["config", "--get", "remote.origin.url"], {
      cwd,
      envOverlay: { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      timeout: 5_000,
    });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

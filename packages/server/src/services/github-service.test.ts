import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGitCommand } from "../utils/run-git-command.js";
import { GitHubAuthManager, MemoryGitHubCredentialStore } from "./github-auth.js";
import {
  assertPullRequestAutoMergeDisableReady,
  assertPullRequestAutoMergeEnableReady,
  computeGithubNextInterval,
  createGitHubService,
  parseStatusCheckRollup,
} from "./github-service.js";
import type { GitHubService } from "./github-service.js";
import type { GitHubPullRequestStatusFacts } from "./github-facts.js";

const originalFetch = globalThis.fetch;
let repoDir: string;
let service: GitHubService | null;

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), "github-octokit-service-"));
  await runGitCommand(["init"], { cwd: repoDir });
  await runGitCommand(["remote", "add", "origin", "https://github.com/acme/repo.git"], {
    cwd: repoDir,
  });
  service = null;
});

afterEach(async () => {
  service?.dispose();
  service = null;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await rm(repoDir, { recursive: true, force: true });
});

async function createService(handler: (request: Request) => Response | Promise<Response>) {
  const store = new MemoryGitHubCredentialStore();
  await store.set({
    version: 1,
    host: "github.com",
    token: "oauth-token",
    userId: 1,
    login: "octocat",
    scopes: ["repo"],
  });
  globalThis.fetch = vi.fn(async (input, init) =>
    handler(new Request(input, init)),
  ) as typeof fetch;
  service = createGitHubService({
    authManager: new GitHubAuthManager({
      config: { githubComClientId: "client" },
      credentialStore: store,
      env: {},
    }),
  });
  return service;
}

function repositoryResponse() {
  return jsonResponse({
    id: 1,
    name: "repo",
    full_name: "acme/repo",
    owner: { login: "acme" },
    parent: null,
  });
}

function readyFacts(
  overrides: Partial<GitHubPullRequestStatusFacts> = {},
): GitHubPullRequestStatusFacts {
  return {
    mergeStateStatus: "CLEAN",
    autoMergeRequest: null,
    viewerCanEnableAutoMerge: true,
    viewerCanDisableAutoMerge: true,
    viewerCanMergeAsAdmin: false,
    viewerCanUpdateBranch: false,
    isMergeQueueEnabled: false,
    isInMergeQueue: false,
    repository: {
      autoMergeAllowed: true,
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      viewerDefaultMergeMethod: "SQUASH",
    },
    ...overrides,
  };
}

describe("GitHubService Octokit reads", () => {
  it("searches issues and pull requests with repository-qualified GraphQL queries", async () => {
    const queries: string[] = [];
    const github = await createService(async (request) => {
      if (new URL(request.url).pathname === "/repos/acme/repo") return repositoryResponse();
      if (new URL(request.url).pathname === "/graphql") {
        const body = (await request.json()) as { variables: { searchQuery: string } };
        queries.push(body.variables.searchQuery);
        const isPullRequest = body.variables.searchQuery.includes("is:pr");
        return graphqlResponse({
          search: {
            nodes: isPullRequest
              ? [
                  {
                    __typename: "PullRequest",
                    number: 12,
                    title: "SDK migration",
                    url: "https://github.com/acme/repo/pull/12",
                    state: "OPEN",
                    body: "PR body",
                    baseRefName: "main",
                    headRefName: "octokit",
                    updatedAt: "2026-08-27T12:00:00Z",
                    labels: { nodes: [{ name: "api" }] },
                  },
                ]
              : [
                  {
                    __typename: "Issue",
                    number: 11,
                    title: "Remove gh",
                    url: "https://github.com/acme/repo/issues/11",
                    state: "OPEN",
                    body: "Issue body",
                    updatedAt: "2026-08-27T11:00:00Z",
                    labels: { nodes: [{ name: "auth" }] },
                  },
                ],
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await github.searchIssuesAndPrs({ cwd: repoDir, query: "oauth", limit: 20 });
    expect(result.items).toEqual([
      expect.objectContaining({ kind: "change_request", number: 12, headRefName: "octokit" }),
      expect.objectContaining({ kind: "issue", number: 11, labels: ["auth"] }),
    ]);
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(
      expect.arrayContaining(["oauth repo:acme/repo is:issue", "oauth repo:acme/repo is:pr"]),
    );
  });

  it("loads current PR status, checks, and GitHub merge facts without gh", async () => {
    const github = await createService(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/repos/acme/repo") return repositoryResponse();
      if (url.pathname === "/repos/acme/repo/pulls") {
        expect(url.searchParams.get("head")).toBe("acme:octokit");
        return jsonResponse([
          {
            number: 42,
            html_url: "https://github.com/acme/repo/pull/42",
            title: "Native GitHub API",
            state: "open",
            merged_at: null,
            draft: false,
            base: { ref: "main", repo: { name: "repo", owner: { login: "acme" } } },
            head: {
              ref: "octokit",
              sha: "head-sha",
              repo: { name: "repo", owner: { login: "acme" } },
            },
          },
        ]);
      }
      if (url.pathname === "/graphql") {
        return graphqlResponse({
          repository: {
            autoMergeAllowed: true,
            mergeCommitAllowed: true,
            squashMergeAllowed: true,
            rebaseMergeAllowed: true,
            viewerDefaultMergeMethod: "SQUASH",
            pullRequest: {
              id: "PR_node",
              number: 42,
              url: "https://github.com/acme/repo/pull/42",
              title: "Native GitHub API",
              state: "OPEN",
              isDraft: false,
              baseRefName: "main",
              headRefName: "octokit",
              headRefOid: "head-sha",
              mergedAt: null,
              reviewDecision: "APPROVED",
              mergeable: "MERGEABLE",
              headRepositoryOwner: { login: "acme" },
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    {
                      __typename: "CheckRun",
                      databaseId: 99,
                      name: "test",
                      workflowName: "CI",
                      conclusion: "SUCCESS",
                      status: "COMPLETED",
                      detailsUrl: "https://github.com/acme/repo/actions/runs/1",
                      startedAt: "2026-08-27T10:00:00Z",
                      completedAt: "2026-08-27T10:01:00Z",
                      checkSuite: { workflowRun: { databaseId: 1 } },
                    },
                  ],
                },
              },
              mergeStateStatus: "CLEAN",
              autoMergeRequest: null,
              viewerCanEnableAutoMerge: true,
              viewerCanDisableAutoMerge: true,
              viewerCanMergeAsAdmin: false,
              viewerCanUpdateBranch: true,
              isMergeQueueEnabled: false,
              isInMergeQueue: false,
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const status = await github.getCurrentPullRequestStatus({
      cwd: repoDir,
      headRef: "octokit",
      headSha: "head-sha",
    });
    expect(status).toMatchObject({
      number: 42,
      repoOwner: "acme",
      repoName: "repo",
      checksStatus: "success",
      reviewDecision: "approved",
      forgeSpecific: {
        forge: "github",
        mergeStateStatus: "CLEAN",
        viewerCanUpdateBranch: true,
      },
    });
    expect(status?.checks).toEqual([
      expect.objectContaining({ name: "test", status: "success", workflowRunId: 1 }),
    ]);
  });

  it("keeps core PR status when Enterprise GraphQL lacks newer merge fields", async () => {
    const queries: string[] = [];
    const github = await createService(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/repos/acme/repo") return repositoryResponse();
      if (url.pathname === "/repos/acme/repo/pulls") {
        return jsonResponse([
          {
            number: 42,
            html_url: "https://github.com/acme/repo/pull/42",
            title: "Enterprise compatibility",
            state: "open",
            merged_at: null,
            draft: false,
            base: { ref: "main", repo: { name: "repo", owner: { login: "acme" } } },
            head: {
              ref: "feature",
              sha: "head-sha",
              repo: { name: "repo", owner: { login: "acme" } },
            },
          },
        ]);
      }
      if (url.pathname === "/graphql") {
        const body = (await request.json()) as { query: string };
        queries.push(body.query);
        if (!body.query.includes("CurrentPullRequestCore")) {
          return jsonResponse({
            data: null,
            errors: [
              {
                message: "Field 'isMergeQueueEnabled' doesn't exist on type 'PullRequest'",
              },
            ],
          });
        }
        return graphqlResponse({
          repository: {
            pullRequest: {
              id: "PR_node",
              number: 42,
              url: "https://github.com/acme/repo/pull/42",
              title: "Enterprise compatibility",
              state: "OPEN",
              isDraft: false,
              baseRefName: "main",
              headRefName: "feature",
              headRefOid: "head-sha",
              mergedAt: null,
              reviewDecision: null,
              mergeable: "UNKNOWN",
              headRepositoryOwner: { login: "acme" },
              statusCheckRollup: { contexts: { nodes: [] } },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const status = await github.getCurrentPullRequestStatus({
      cwd: repoDir,
      headRef: "feature",
      headSha: "head-sha",
    });
    expect(status).toMatchObject({
      number: 42,
      title: "Enterprise compatibility",
      checksStatus: "none",
    });
    expect(status?.forgeSpecific).toBeUndefined();
    expect(queries.some((query) => query.includes("CurrentPullRequestCore"))).toBe(true);
  });

  it("loads a PR timeline through GraphQL", async () => {
    const github = await createService(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/graphql") {
        return graphqlResponse({
          repository: {
            pullRequest: {
              number: 42,
              reviews: { nodes: [], pageInfo: { hasNextPage: false } },
              comments: {
                nodes: [
                  {
                    id: "comment-1",
                    body: "Looks good",
                    bodyHTML: "<p>Looks good</p>",
                    url: "https://github.com/acme/repo/pull/42#issuecomment-1",
                    createdAt: "2026-08-27T12:00:00Z",
                    author: {
                      login: "octocat",
                      url: "https://github.com/octocat",
                      avatarUrl: "https://avatars.githubusercontent.com/u/1",
                    },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
              reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    await expect(
      github.getPullRequestTimeline({
        cwd: repoDir,
        prNumber: 42,
        repoOwner: "acme",
        repoName: "repo",
      }),
    ).resolves.toMatchObject({
      prNumber: 42,
      items: [{ kind: "comment", id: "comment-1", body: "Looks good" }],
      truncated: false,
      error: null,
    });
  });

  it("loads check annotations, failed jobs, and capped job logs", async () => {
    const github = await createService(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/repos/acme/repo/check-runs/99") {
        return jsonResponse({
          id: 99,
          name: "test",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/acme/repo/runs/99",
          details_url: "https://github.com/acme/repo/runs/99",
          output: { title: "Failed", summary: "One failure", text: null },
          check_suite: { workflow_run: { id: 5 } },
        });
      }
      if (path === "/repos/acme/repo/check-runs/99/annotations") {
        return jsonResponse([
          {
            path: "src/index.ts",
            start_line: 10,
            end_line: 10,
            annotation_level: "failure",
            message: "Expected true",
          },
        ]);
      }
      if (path === "/repos/acme/repo/actions/runs/5/jobs") {
        return jsonResponse({
          total_count: 1,
          jobs: [
            {
              id: 7,
              name: "unit",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/acme/repo/actions/runs/5/job/7",
              completed_at: "2026-08-27T12:00:00Z",
            },
          ],
        });
      }
      if (path === "/repos/acme/repo/actions/jobs/7/logs") {
        return new Response("failure line\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    await expect(
      github.getCheckDetails({
        cwd: repoDir,
        repoOwner: "acme",
        repoName: "repo",
        checkRunId: 99,
      }),
    ).resolves.toMatchObject({
      checkRunId: 99,
      workflowRunId: 5,
      annotations: [{ path: "src/index.ts", message: "Expected true" }],
      failedJobs: [{ jobId: 7, name: "unit", logTail: "failure line\n" }],
    });
  });
});

describe("GitHubService Octokit writes", () => {
  it("creates a pull request through the REST API", async () => {
    const github = await createService(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/repos/acme/repo" && request.method === "GET") return repositoryResponse();
      if (path === "/repos/acme/repo/pulls" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ title: "Ship SDK", head: "feature", base: "main" });
        return jsonResponse({
          number: 55,
          html_url: "https://github.com/acme/repo/pull/55",
        });
      }
      return new Response("not found", { status: 404 });
    });

    await expect(
      github.createPullRequest({
        cwd: repoDir,
        title: "Ship SDK",
        head: "feature",
        base: "main",
        body: "Body",
      }),
    ).resolves.toEqual({ url: "https://github.com/acme/repo/pull/55", number: 55 });
  });

  it("merges only after server-side readiness guards pass", async () => {
    const github = await createService(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/repos/acme/repo" && request.method === "GET") return repositoryResponse();
      if (path === "/repos/acme/repo/pulls/42/merge" && request.method === "PUT") {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.merge_method).toBe("squash");
        return jsonResponse({ merged: true, message: "Pull Request successfully merged" });
      }
      return new Response("not found", { status: 404 });
    });
    const status = {
      repoOwner: "acme",
      repoName: "repo",
      mergeable: "MERGEABLE" as const,
      forgeSpecific: { forge: "github", ...readyFacts() },
    };

    await expect(
      github.mergePullRequest({ cwd: repoDir, prNumber: 42, mergeMethod: "squash", status }),
    ).resolves.toEqual({ success: true });
  });

  it("enables and disables auto-merge with GraphQL mutations", async () => {
    const seenQueries: string[] = [];
    const github = await createService(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/repos/acme/repo") return repositoryResponse();
      if (path === "/graphql") {
        const body = (await request.json()) as {
          query: string;
          variables: Record<string, unknown>;
        };
        seenQueries.push(body.query);
        if (body.query.includes("PullRequestNodeId")) {
          return graphqlResponse({ repository: { pullRequest: { id: "PR_node" } } });
        }
        if (body.query.includes("EnablePullRequestAutoMerge")) {
          expect(body.variables).toMatchObject({ pullRequestId: "PR_node", mergeMethod: "REBASE" });
          return graphqlResponse({
            enablePullRequestAutoMerge: { pullRequest: { number: 42 } },
          });
        }
        return graphqlResponse({
          disablePullRequestAutoMerge: { pullRequest: { number: 42 } },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const enableStatus = {
      repoOwner: "acme",
      repoName: "repo",
      forgeSpecific: {
        forge: "github",
        ...readyFacts({ mergeStateStatus: "BLOCKED", autoMergeRequest: null }),
      },
    };
    const disableStatus = {
      repoOwner: "acme",
      repoName: "repo",
      forgeSpecific: {
        forge: "github",
        ...readyFacts({
          mergeStateStatus: "BLOCKED",
          autoMergeRequest: {
            enabledAt: "2026-08-27T12:00:00Z",
            enabledBy: "octocat",
            mergeMethod: "REBASE",
          },
        }),
      },
    };

    await expect(
      github.enablePullRequestAutoMerge({
        cwd: repoDir,
        prNumber: 42,
        mergeMethod: "rebase",
        status: enableStatus,
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      github.disablePullRequestAutoMerge({ cwd: repoDir, prNumber: 42, status: disableStatus }),
    ).resolves.toEqual({ success: true });
    expect(seenQueries.filter((query) => query.includes("PullRequestNodeId"))).toHaveLength(2);
  });
});

describe("GitHub status policy", () => {
  it("maps check rollups and keeps only the newest duplicate context", () => {
    expect(
      parseStatusCheckRollup([
        {
          __typename: "StatusContext",
          context: "deploy",
          state: "PENDING",
          createdAt: "2026-08-27T10:00:00Z",
        },
        {
          __typename: "StatusContext",
          context: "deploy",
          state: "SUCCESS",
          createdAt: "2026-08-27T11:00:00Z",
        },
      ]),
    ).toEqual([expect.objectContaining({ name: "deploy", status: "success" })]);
  });

  it("computes fast, slow, and backed-off polling intervals", () => {
    const open = {
      url: "https://github.com/acme/repo/pull/1",
      title: "PR",
      state: "open",
      baseRefName: "main",
      headRefName: "feature",
      isMerged: false,
      mergeable: "UNKNOWN" as const,
      checks: [],
      checksStatus: "none" as const,
      reviewDecision: null,
    };
    const pending = {
      ...open,
      checks: [{ name: "ci", status: "pending" as const, url: null }],
      checksStatus: "pending" as const,
    };
    expect(computeGithubNextInterval(pending, 0)).toBe(20_000);
    expect(computeGithubNextInterval(open, 0)).toBe(120_000);
    expect(computeGithubNextInterval(pending, 3)).toBe(80_000);
  });

  it("enforces auto-merge state transitions", () => {
    expect(() =>
      assertPullRequestAutoMergeEnableReady({
        mergeMethod: "squash",
        status: {
          forgeSpecific: {
            forge: "github",
            ...readyFacts({ mergeStateStatus: "BLOCKED", autoMergeRequest: null }),
          },
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertPullRequestAutoMergeDisableReady({
        status: {
          forgeSpecific: {
            forge: "github",
            ...readyFacts({
              autoMergeRequest: {
                enabledAt: null,
                enabledBy: "octocat",
                mergeMethod: "SQUASH",
              },
            }),
          },
        },
      }),
    ).not.toThrow();
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function graphqlResponse(data: unknown): Response {
  return jsonResponse({ data });
}

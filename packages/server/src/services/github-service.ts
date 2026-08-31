import type { Octokit } from "@octokit/rest";
import {
  parseGitHubRemoteIdentity,
  parseGitRemoteLocation,
} from "@omp-desktop/protocol/git-remote";
import { z } from "zod";
import { runGitCommand } from "../utils/run-git-command.js";
import {
  GitHubAuthManager,
  type GitHubAuthConfig,
  type GitHubCredentialStore,
  type GitHubLoginResult,
  type GitHubLoginStart,
} from "./github-auth.js";
import {
  callGitHub,
  GitHubApiError,
  GitHubAuthenticationError,
  GitHubClientFactory,
  GitHubHostNotConfiguredError,
} from "./github-client.js";
import {
  computeChecksStatus,
  compareTimelineItems,
  createUnavailableSearchResult,
  normalizeForgeSearchKinds,
  parseOptionalTime,
} from "./forge-service.js";
import type {
  CheckAnnotation,
  CheckDetails,
  CheckFailedJob,
  CurrentPullRequestStatus,
  DisablePullRequestAutoMergeOptions,
  EnablePullRequestAutoMergeOptions,
  ForgeReadOptions,
  ForgeService,
  IssueSummary,
  MergePullRequestOptions,
  PullRequestCheck,
  PullRequestCheckoutTarget,
  PullRequestCheckStatus,
  PullRequestCommandStatus,
  PullRequestMergeMethod,
  PullRequestReviewDecision,
  PullRequestSummary,
  PullRequestTimeline,
  PullRequestTimelineError,
  PullRequestTimelineItem,
  PullRequestTimelineReviewState,
  SearchResult,
} from "./forge-service.js";
import {
  isGitHubPullRequestStatusFacts,
  type GitHubPullRequestStatusFacts,
} from "./github-facts.js";
export { GitHubApiError, GitHubAuthenticationError, GitHubHostNotConfiguredError };

export type {
  CheckAnnotation,
  CheckDetails,
  CheckFailedJob,
  CreatePullRequestOptions,
  CurrentPullRequestStatus,
  DisablePullRequestAutoMergeOptions,
  EnablePullRequestAutoMergeOptions,
  ForgeAuthState,
  ForgeReadOptions,
  ForgeService,
  ForgeSpecificStatusFacts,
  GetCheckDetailsOptions,
  GetPullRequestOptions,
  GetPullRequestTimelineOptions,
  IssueSummary,
  ListIssuesOptions,
  ListPullRequestsOptions,
  MergePullRequestOptions,
  PullRequestAutoMergeResult,
  PullRequestCheck,
  PullRequestCheckoutTarget,
  PullRequestChecksStatus,
  PullRequestCheckStatus,
  PullRequestCommandStatus,
  PullRequestCreateResult,
  PullRequestMergeable,
  PullRequestMergeMethod,
  PullRequestMergeResult,
  PullRequestReviewDecision,
  PullRequestSummary,
  PullRequestTimeline,
  PullRequestTimelineCommentLocation,
  PullRequestTimelineError,
  PullRequestTimelineErrorKind,
  PullRequestTimelineItem,
  PullRequestTimelineReviewState,
  SearchIssuesAndPrsOptions,
  SearchResult,
} from "./forge-service.js";
export type { GitHubPullRequestStatusFacts } from "./github-facts.js";

const DEFAULT_GITHUB_CACHE_TTL_MS = 30_000;
const CHECK_ANNOTATION_PAGE_MAX = 20;
const CHECK_LOG_TAIL_MAX_LINES = 200;
const CHECK_LOG_TAIL_MAX_BYTES = 16 * 1024;
const CHECK_LOG_TAIL_CACHE_MAX_ENTRIES = 128;
const ACTIONS_JOB_PAGE_MAX = 100;
const FAILED_CHECK_JOB_LIMIT = 5;
export const GITHUB_POLL_FAST_INTERVAL_MS = 20_000;
export const GITHUB_POLL_SLOW_INTERVAL_MS = 120_000;
export const GITHUB_POLL_ERROR_BACKOFF_CAP_MS = 300_000;
const GIT_ORIGIN_URL_READ_TIMEOUT_MS = 5_000;

const LabelSchema = z.object({
  name: z.string().optional(),
});

const GitHubIssueSummarySchema = z.object({
  number: z.number(),
  title: z.string().catch(""),
  url: z.string().catch(""),
  state: z.string().catch(""),
  body: z.string().nullable().catch(null),
  labels: z.array(LabelSchema).catch([]),
  updatedAt: z.string().catch(""),
});

const GitHubPullRequestSummarySchema = z.object({
  number: z.number(),
  title: z.string().catch(""),
  url: z.string().catch(""),
  state: z.string().catch(""),
  body: z.string().nullable().catch(null),
  baseRefName: z.string().catch(""),
  headRefName: z.string().catch(""),
  labels: z.array(LabelSchema).catch([]),
  updatedAt: z.string().catch(""),
});

const PullRequestCheckRunNodeSchema = z.object({
  __typename: z.literal("CheckRun"),
  databaseId: z.number().nullable().optional(),
  name: z.string(),
  workflowName: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  checkSuite: z
    .object({
      workflowRun: z
        .object({
          databaseId: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const PullRequestStatusContextNodeSchema = z.object({
  __typename: z.literal("StatusContext"),
  context: z.string(),
  state: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

const PullRequestStatusCheckRollupNodeSchema = z.discriminatedUnion("__typename", [
  PullRequestCheckRunNodeSchema,
  PullRequestStatusContextNodeSchema,
]);

const PullRequestStatusCheckRollupArraySchema = z.array(z.unknown());
const LegacyPullRequestStatusCheckRollupSchema = z.object({
  contexts: z.array(z.unknown()),
});

const GitHubCheckRunDetailsSchema = z.object({
  id: z.number(),
  name: z.string().catch(""),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  details_url: z.string().nullable().optional(),
  output: z
    .object({
      title: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  check_suite: z
    .object({
      workflow_run: z
        .object({
          id: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const GitHubCheckAnnotationSchema = z.object({
  path: z.string().optional(),
  start_line: z.number().optional(),
  end_line: z.number().optional(),
  annotation_level: z.string().optional(),
  message: z.string().optional(),
  title: z.string().optional(),
  raw_details: z.string().optional(),
});

const GitHubCheckAnnotationsSchema = z.array(GitHubCheckAnnotationSchema).catch([]);

const GitHubActionsJobSchema = z.object({
  id: z.number(),
  name: z.string().catch(""),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
});

const GitHubActionsJobsSchema = z.object({
  jobs: z.array(GitHubActionsJobSchema).catch([]),
});

const PullRequestReviewDecisionSchema = z
  .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
  .nullable()
  .catch(null);

const HeadRepositoryOwnerSchema = z
  .object({
    login: z.string().optional(),
  })
  .nullable()
  .optional();

const PullRequestMergeableSchema = z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN");

const GitHubAutoMergeRequestSchema = z
  .object({
    enabledAt: z.string().nullable().optional().catch(null),
    mergeMethod: z.string().nullable().optional().catch(null),
    enabledBy: z
      .object({
        login: z.string().nullable().optional().catch(null),
      })
      .nullable()
      .optional()
      .catch(null),
  })
  .nullable()
  .optional()
  .catch(null);

const GitHubPullRequestFactsGraphqlSchema = z.object({
  data: z.object({
    repository: z
      .object({
        autoMergeAllowed: z.boolean().optional().catch(false),
        mergeCommitAllowed: z.boolean().optional().catch(false),
        squashMergeAllowed: z.boolean().optional().catch(false),
        rebaseMergeAllowed: z.boolean().optional().catch(false),
        viewerDefaultMergeMethod: z.string().nullable().optional().catch(null),
        pullRequest: z
          .object({
            mergeStateStatus: z.string().nullable().optional().catch(null),
            autoMergeRequest: GitHubAutoMergeRequestSchema,
            viewerCanEnableAutoMerge: z.boolean().optional().catch(false),
            viewerCanDisableAutoMerge: z.boolean().optional().catch(false),
            viewerCanMergeAsAdmin: z.boolean().optional().catch(false),
            viewerCanUpdateBranch: z.boolean().optional().catch(false),
            isMergeQueueEnabled: z.boolean().optional().catch(false),
            isInMergeQueue: z.boolean().optional().catch(false),
          })
          .nullable()
          .optional()
          .catch(null),
      })
      .nullable()
      .optional()
      .catch(null),
  }),
});

const CurrentPullRequestStatusSchema = z.object({
  number: z.number().optional(),
  url: z.string().catch(""),
  title: z.string().catch(""),
  state: z.string().catch(""),
  isDraft: z.boolean().optional().catch(false),
  baseRefName: z.string().catch(""),
  headRefName: z.string().catch(""),
  headRefOid: z.string().optional(),
  mergedAt: z.string().nullable().optional(),
  statusCheckRollup: z.unknown().optional(),
  reviewDecision: z.unknown().optional(),
  mergeable: PullRequestMergeableSchema.optional().default("UNKNOWN"),
  headRepositoryOwner: HeadRepositoryOwnerSchema,
});

const TimelineAuthorSchema = z
  .object({
    login: z.string().optional(),
    url: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const PullRequestTimelineReviewNodeSchema = z.object({
  id: z.string().catch(""),
  state: z.string().catch(""),
  body: z.string().nullable().catch(null),
  bodyHTML: z.string().nullable().catch(null),
  url: z.string().catch(""),
  submittedAt: z.string().nullable().catch(null),
  author: TimelineAuthorSchema,
});

const PullRequestTimelineCommentNodeSchema = z.object({
  id: z.string().catch(""),
  body: z.string().nullable().catch(null),
  bodyHTML: z.string().nullable().catch(null),
  url: z.string().catch(""),
  createdAt: z.string().nullable().catch(null),
  author: TimelineAuthorSchema,
});

const PullRequestReviewThreadCommentNodeSchema = PullRequestTimelineCommentNodeSchema.extend({
  pullRequestReview: z
    .object({ id: z.string().catch("") })
    .nullable()
    .optional()
    .catch(null),
});

const PullRequestReviewThreadNodeSchema = z.object({
  id: z.string().catch(""),
  path: z.string().catch(""),
  line: z.number().nullable().optional().catch(null),
  startLine: z.number().nullable().optional().catch(null),
  isResolved: z.boolean().catch(false),
  isOutdated: z.boolean().catch(false),
  comments: z
    .object({
      nodes: z.array(PullRequestReviewThreadCommentNodeSchema).catch([]),
      pageInfo: z.object({ hasNextPage: z.boolean().catch(false) }).catch({ hasNextPage: false }),
    })
    .catch({ nodes: [], pageInfo: { hasNextPage: false } }),
});

const PullRequestTimelinePageInfoSchema = z.object({
  hasNextPage: z.boolean().catch(false),
});

const PullRequestTimelineGraphqlSchema = z.object({
  data: z
    .object({
      repository: z
        .object({
          pullRequest: z
            .object({
              number: z.number().optional(),
              reviews: z
                .object({
                  nodes: z.array(PullRequestTimelineReviewNodeSchema).catch([]),
                  pageInfo: PullRequestTimelinePageInfoSchema.catch({ hasNextPage: false }),
                })
                .catch({ nodes: [], pageInfo: { hasNextPage: false } }),
              comments: z
                .object({
                  nodes: z.array(PullRequestTimelineCommentNodeSchema).catch([]),
                  pageInfo: PullRequestTimelinePageInfoSchema.catch({ hasNextPage: false }),
                })
                .catch({ nodes: [], pageInfo: { hasNextPage: false } }),
              reviewThreads: z
                .object({
                  nodes: z.array(PullRequestReviewThreadNodeSchema).catch([]),
                  pageInfo: PullRequestTimelinePageInfoSchema.catch({ hasNextPage: false }),
                })
                .catch({ nodes: [], pageInfo: { hasNextPage: false } }),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});

const PullRequestCheckoutTargetSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z
        .object({
          number: z.number(),
          baseRefName: z.string().catch(""),
          headRefName: z.string().catch(""),
          isCrossRepository: z.boolean().catch(false),
          headRepositoryOwner: z
            .object({
              login: z.string().catch(""),
            })
            .nullable()
            .optional(),
          headRepository: z
            .object({
              sshUrl: z.string().nullable().optional(),
              url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable(),
    }),
  }),
});

const PULL_REQUEST_CHECKOUT_TARGET_QUERY = `
query PullRequestCheckoutTarget($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      baseRefName
      headRefName
      isCrossRepository
      headRepositoryOwner {
        login
      }
      headRepository {
        sshUrl
        url
      }
    }
  }
}`;

const PULL_REQUEST_TIMELINE_QUERY = `
query PullRequestTimeline($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      reviews(first: 100) {
        nodes {
          id
          state
          body
          bodyHTML
          url
          submittedAt
          author {
            login
            url
            avatarUrl
          }
        }
        pageInfo {
          hasNextPage
        }
      }
      comments(first: 100) {
        nodes {
          id
          body
          bodyHTML
          url
          createdAt
          author {
            login
            url
            avatarUrl
          }
        }
        pageInfo {
          hasNextPage
        }
      }
      reviewThreads(first: 100) {
        nodes {
          id
          path
          line
          startLine
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              id
              body
              bodyHTML
              url
              createdAt
              author {
                login
                url
                avatarUrl
              }
              pullRequestReview {
                id
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  }
}`;

const SearchLabelsSchema = z.object({
  nodes: z.array(LabelSchema).catch([]),
});

const GitHubSearchIssueNodeSchema = GitHubIssueSummarySchema.extend({
  __typename: z.literal("Issue"),
  labels: SearchLabelsSchema,
});

const GitHubSearchPullRequestNodeSchema = GitHubPullRequestSummarySchema.extend({
  __typename: z.literal("PullRequest"),
  labels: SearchLabelsSchema,
});

const GitHubSearchGraphqlSchema = z.object({
  search: z.object({
    nodes: z.array(z.unknown()).catch([]),
  }),
});

const GitHubPullRequestGraphqlSchema = z.object({
  repository: z
    .object({
      pullRequest: GitHubSearchPullRequestNodeSchema.omit({ __typename: true }).nullable(),
    })
    .nullable(),
});

const CurrentPullRequestGraphqlSchema = z.object({
  repository: z
    .object({
      autoMergeAllowed: z.boolean().optional().catch(false),
      mergeCommitAllowed: z.boolean().optional().catch(false),
      squashMergeAllowed: z.boolean().optional().catch(false),
      rebaseMergeAllowed: z.boolean().optional().catch(false),
      viewerDefaultMergeMethod: z.string().nullable().optional().catch(null),
      pullRequest: CurrentPullRequestStatusSchema.extend({
        id: z.string(),
        mergeStateStatus: z.string().nullable().optional().catch(null),
        autoMergeRequest: GitHubAutoMergeRequestSchema,
        viewerCanEnableAutoMerge: z.boolean().optional().catch(false),
        viewerCanDisableAutoMerge: z.boolean().optional().catch(false),
        viewerCanMergeAsAdmin: z.boolean().optional().catch(false),
        viewerCanUpdateBranch: z.boolean().optional().catch(false),
        isMergeQueueEnabled: z.boolean().optional().catch(false),
        isInMergeQueue: z.boolean().optional().catch(false),
        statusCheckRollup: z
          .object({
            contexts: z.object({
              nodes: z.array(z.unknown()).catch([]),
            }),
          })
          .nullable()
          .optional(),
      })
        .nullable()
        .catch(null),
    })
    .nullable()
    .catch(null),
});

const PullRequestNodeIdGraphqlSchema = z.object({
  repository: z
    .object({
      pullRequest: z.object({ id: z.string() }).nullable(),
    })
    .nullable(),
});

const GITHUB_SEARCH_QUERY = `
query SearchGitHubIssuesAndPullRequests($searchQuery: String!, $first: Int!) {
  search(query: $searchQuery, type: ISSUE, first: $first) {
    nodes {
      __typename
      ... on Issue {
        number
        title
        url
        state
        body
        updatedAt
        labels(first: 50) { nodes { name } }
      }
      ... on PullRequest {
        number
        title
        url
        state
        body
        baseRefName
        headRefName
        updatedAt
        labels(first: 50) { nodes { name } }
      }
    }
  }
}`;

const PULL_REQUEST_SUMMARY_QUERY = `
query PullRequestSummary($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      url
      state
      body
      baseRefName
      headRefName
      updatedAt
      labels(first: 50) { nodes { name } }
    }
  }
}`;

const CURRENT_PULL_REQUEST_QUERY = `
query CurrentPullRequest($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    autoMergeAllowed
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    viewerDefaultMergeMethod
    pullRequest(number: $number) {
      id
      number
      url
      title
      state
      isDraft
      baseRefName
      headRefName
      headRefOid
      mergedAt
      reviewDecision
      mergeable
      headRepositoryOwner { login }
      statusCheckRollup {
        contexts(first: 100) {
          nodes {
            __typename
            ... on CheckRun {
              databaseId
              name
              workflowName
              conclusion
              status
              detailsUrl
              startedAt
              completedAt
              checkSuite {
                workflowRun { databaseId }
              }
            }
            ... on StatusContext {
              context
              state
              targetUrl
              createdAt
            }
          }
        }
      }
      mergeStateStatus
      autoMergeRequest {
        enabledAt
        mergeMethod
        enabledBy { login }
      }
      viewerCanEnableAutoMerge
      viewerCanDisableAutoMerge
      viewerCanMergeAsAdmin
      viewerCanUpdateBranch
      isMergeQueueEnabled
      isInMergeQueue
    }
  }
}`;

const CURRENT_PULL_REQUEST_WITHOUT_CHECKS_QUERY = CURRENT_PULL_REQUEST_QUERY.replace(
  /\\n      statusCheckRollup \\{[\\s\\S]*?\\n      \\}\\n      mergeStateStatus/,
  "\n      mergeStateStatus",
);

const CURRENT_PULL_REQUEST_CORE_QUERY = `
query CurrentPullRequestCore($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      number
      url
      title
      state
      isDraft
      baseRefName
      headRefName
      headRefOid
      mergedAt
      reviewDecision
      mergeable
      headRepositoryOwner { login }
      statusCheckRollup {
        contexts(first: 100) {
          nodes {
            __typename
            ... on CheckRun {
              databaseId
              name
              workflowName
              conclusion
              status
              detailsUrl
              startedAt
              completedAt
              checkSuite {
                workflowRun { databaseId }
              }
            }
            ... on StatusContext {
              context
              state
              targetUrl
              createdAt
            }
          }
        }
      }
    }
  }
}`;

const CURRENT_PULL_REQUEST_CORE_WITHOUT_CHECKS_QUERY = CURRENT_PULL_REQUEST_CORE_QUERY.replace(
  /\\n      statusCheckRollup \\{[\\s\\S]*?\\n      \\}\\n    \\}/,
  "\n    }",
);

const PULL_REQUEST_NODE_ID_QUERY = `
query PullRequestNodeId($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id }
  }
}`;

const ENABLE_PULL_REQUEST_AUTO_MERGE_MUTATION = `
mutation EnablePullRequestAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(
    input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }
  ) {
    pullRequest { number }
  }
}`;

const DISABLE_PULL_REQUEST_AUTO_MERGE_MUTATION = `
mutation DisablePullRequestAutoMerge($pullRequestId: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
    pullRequest { number }
  }
}`;

const DIRECT_PULL_REQUEST_MERGE_STATE_ALLOWLIST = new Set(["CLEAN", "HAS_HOOKS"]);

type PullRequestCheckRunNode = z.infer<typeof PullRequestCheckRunNodeSchema>;
type PullRequestStatusContextNode = z.infer<typeof PullRequestStatusContextNodeSchema>;
type CurrentPullRequestStatusItem = z.infer<typeof CurrentPullRequestStatusSchema>;
type GitHubPullRequestFactsGraphql = z.infer<typeof GitHubPullRequestFactsGraphqlSchema>;
type GitHubPullRequestFactsRepository = NonNullable<
  GitHubPullRequestFactsGraphql["data"]["repository"]
>;
type GitHubPullRequestFactsPullRequest = NonNullable<
  GitHubPullRequestFactsRepository["pullRequest"]
>;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  cwd: string;
}

interface InFlightCacheEntry {
  cwd: string;
  promise: Promise<unknown>;
  force: boolean;
}

interface GitHubPollTarget {
  cwd: string;
  headRef: string;
  headSha?: string;
  headRepositoryOwner?: string;
  retainCount: number;
  timer: NodeJS.Timeout | null;
  latestStatus: CurrentPullRequestStatus | null;
  consecutiveErrors: number;
  callbacks: Set<(status: CurrentPullRequestStatus | null) => void>;
  errorCallbacks: Set<(error: unknown) => void>;
}

interface ResolvedPullRequestCandidate {
  status: CurrentPullRequestStatus;
  headSha?: string;
  headRepositoryOwner?: string;
}

interface GitHubRepositoryContext {
  host: string;
  owner: string;
  name: string;
  parent: { owner: string; name: string } | null;
  octokit: Octokit;
}

export interface GitHubRepositorySummary {
  id: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  visibility: "public" | "private" | "internal";
  updatedAt: string;
  cloneUrl: string;
}

export interface SearchGitHubRepositoriesOptions {
  cwd: string;
  query: string;
  limit?: number;
}

export interface GitHubService extends ForgeService {
  searchRepositories(options: SearchGitHubRepositoriesOptions): Promise<GitHubRepositorySummary[]>;
  isConfiguredHost(host: string): boolean;
  beginLogin(input: { cwd?: string; host?: string }): Promise<GitHubLoginStart>;
  finishLogin(flowId: string): Promise<GitHubLoginResult>;
  cancelLogin(flowId: string): void;
  logout(input: { cwd?: string; host?: string }): Promise<string>;
}

export interface CreateGitHubServiceOptions {
  ttlMs?: number;
  now?: () => number;
  authConfig?: GitHubAuthConfig;
  credentialStore?: GitHubCredentialStore;
  authManager?: GitHubAuthManager;
  clientFactory?: GitHubClientFactory;
  env?: NodeJS.ProcessEnv;
}

export function createGitHubService(options: CreateGitHubServiceOptions = {}): GitHubService {
  const ttlMs = options.ttlMs ?? DEFAULT_GITHUB_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const auth =
    options.authManager ??
    new GitHubAuthManager({
      config: options.authConfig,
      credentialStore: options.credentialStore,
      env: options.env,
      now,
    });
  const clients = options.clientFactory ?? new GitHubClientFactory({ auth });
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightCacheEntry>();
  const pollTargets = new Map<string, GitHubPollTarget>();
  const checkLogTailCache = new Map<string, { logTail: string; logTruncated: boolean }>();
  let api!: GitHubService;

  async function cached<T>(params: {
    cwd: string;
    method: string;
    args: unknown;
    readOptions?: ForgeReadOptions;
    load: () => Promise<T>;
  }): Promise<T> {
    if (params.readOptions?.force && !params.readOptions.reason) {
      throw new Error("ForgeService forced read requires a reason");
    }
    const key = buildCacheKey({ cwd: params.cwd, method: params.method, args: params.args });
    const cachedEntry = cache.get(key);
    if (!params.readOptions?.force && cachedEntry && cachedEntry.expiresAt > now()) {
      return cachedEntry.value as T;
    }
    const existing = inFlight.get(key);
    if (existing && (!params.readOptions?.force || existing.force)) {
      return existing.promise as Promise<T>;
    }
    const request = params
      .load()
      .then((value) => {
        if (inFlight.get(key)?.promise === request) {
          cache.set(key, { value, cwd: params.cwd, expiresAt: now() + ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (inFlight.get(key)?.promise === request) inFlight.delete(key);
      });
    inFlight.set(key, {
      cwd: params.cwd,
      promise: request,
      force: params.readOptions?.force === true,
    });
    return request;
  }

  async function repositoryContext(cwd: string): Promise<GitHubRepositoryContext> {
    const { host, octokit } = await clients.forCwd(cwd);
    const slug = await resolveGitHubSlugFromOrigin(cwd);
    if (!slug) throw new Error("Unable to resolve GitHub repository from origin");
    const [owner, name] = slug.split("/");
    const response = await callGitHub(host, "repository lookup", () =>
      octokit.rest.repos.get({ owner, repo: name }),
    );
    return {
      host,
      owner: response.data.owner.login,
      name: response.data.name,
      parent: response.data.parent
        ? { owner: response.data.parent.owner.login, name: response.data.parent.name }
        : null,
      octokit,
    };
  }

  async function searchIssuesOrPullRequests(input: {
    cwd: string;
    query: string;
    limit: number;
    kind: "issue" | "pull_request";
  }): Promise<Array<IssueSummary | PullRequestSummary>> {
    const repository = await repositoryContext(input.cwd);
    const kindQualifier = input.kind === "issue" ? "is:issue" : "is:pr";
    const query = [input.query.trim(), `repo:${repository.owner}/${repository.name}`, kindQualifier]
      .filter(Boolean)
      .join(" ");
    const response = await callGitHub(repository.host, "issue and pull request search", () =>
      repository.octokit.graphql(GITHUB_SEARCH_QUERY, {
        searchQuery: query,
        first: Math.min(Math.max(input.limit, 1), 100),
      }),
    );
    const parsed = GitHubSearchGraphqlSchema.parse(response);
    if (input.kind === "issue") {
      return parsed.search.nodes.flatMap((node) => {
        const item = GitHubSearchIssueNodeSchema.safeParse(node);
        if (!item.success) return [];
        return [
          toIssueSummary({
            ...item.data,
            labels: item.data.labels.nodes,
          }),
        ];
      });
    }
    return parsed.search.nodes.flatMap((node) => {
      const item = GitHubSearchPullRequestNodeSchema.safeParse(node);
      if (!item.success) return [];
      return [
        toPullRequestSummary({
          ...item.data,
          labels: item.data.labels.nodes,
        }),
      ];
    });
  }

  async function currentPullRequestStatus(input: {
    cwd: string;
    headRef: string;
    headSha?: string;
    headRepositoryOwner?: string;
  }): Promise<CurrentPullRequestStatus | null> {
    const repository = await repositoryContext(input.cwd);
    const headOwner = input.headRepositoryOwner ?? repository.owner;
    const targets = [
      { owner: repository.owner, name: repository.name },
      ...(repository.parent ? [repository.parent] : []),
    ];
    const settled = await Promise.all(
      targets.map((target) =>
        callGitHub(repository.host, "pull request candidates", () =>
          repository.octokit.rest.pulls.list({
            owner: target.owner,
            repo: target.name,
            state: "all",
            head: `${headOwner}:${input.headRef}`,
            per_page: 10,
          }),
        ),
      ),
    );
    const candidates = settled.flatMap((response) =>
      response.data.map((pullRequest) => {
        const isMerged =
          typeof pullRequest.merged_at === "string" && pullRequest.merged_at.length > 0;
        return {
          status: {
            number: pullRequest.number,
            repoOwner: pullRequest.base.repo.owner.login,
            repoName: pullRequest.base.repo.name,
            url: pullRequest.html_url,
            title: pullRequest.title,
            state: isMerged ? "merged" : pullRequest.state,
            baseRefName: pullRequest.base.ref,
            headRefName: pullRequest.head.ref,
            isMerged,
            isDraft: pullRequest.draft ?? false,
            mergeable: "UNKNOWN" as const,
            checks: [],
            checksStatus: "none" as const,
            reviewDecision: null,
          },
          headSha: pullRequest.head.sha,
          headRepositoryOwner: pullRequest.head.repo?.owner.login,
        };
      }),
    );
    const selected = pickPullRequestCandidate({
      candidates,
      headRef: input.headRef,
      headSha: input.headSha,
      headRepositoryOwner: input.headRepositoryOwner ?? headOwner,
    });
    if (!selected?.status.repoOwner || !selected.status.repoName || !selected.status.number) {
      return null;
    }
    return loadCurrentPullRequest({
      cwd: input.cwd,
      host: repository.host,
      octokit: repository.octokit,
      owner: selected.status.repoOwner,
      name: selected.status.repoName,
      number: selected.status.number,
      fallbackHeadRefName: input.headRef,
    });
  }

  async function loadCurrentPullRequest(input: {
    cwd: string;
    host: string;
    octokit: Octokit;
    owner: string;
    name: string;
    number: number;
    fallbackHeadRefName: string;
  }): Promise<CurrentPullRequestStatus | null> {
    const variables = {
      owner: input.owner,
      name: input.name,
      number: input.number,
    };
    const execute = (query: string) =>
      callGitHub(input.host, "pull request status", () => input.octokit.graphql(query, variables));
    let response: unknown;
    let factsAvailable = true;
    try {
      response = await execute(CURRENT_PULL_REQUEST_QUERY);
    } catch (error) {
      if (error instanceof GitHubApiError && error.status !== null) throw error;
      if (isStatusCheckRollupUnavailable(error)) {
        try {
          response = await execute(CURRENT_PULL_REQUEST_WITHOUT_CHECKS_QUERY);
        } catch (withoutChecksError) {
          if (withoutChecksError instanceof GitHubApiError && withoutChecksError.status !== null) {
            throw withoutChecksError;
          }
          factsAvailable = false;
          response = await execute(CURRENT_PULL_REQUEST_CORE_WITHOUT_CHECKS_QUERY);
        }
      } else {
        factsAvailable = false;
        try {
          response = await execute(CURRENT_PULL_REQUEST_CORE_QUERY);
        } catch (coreError) {
          if (!isStatusCheckRollupUnavailable(coreError)) throw coreError;
          response = await execute(CURRENT_PULL_REQUEST_CORE_WITHOUT_CHECKS_QUERY);
        }
      }
    }
    const parsed = CurrentPullRequestGraphqlSchema.parse(response);
    const pullRequest = parsed.repository?.pullRequest;
    if (!pullRequest || !parsed.repository) return null;
    const status = toCurrentPullRequestStatus(
      {
        ...pullRequest,
        statusCheckRollup: pullRequest.statusCheckRollup?.contexts.nodes,
      },
      input.fallbackHeadRefName,
    );
    if (!status || !factsAvailable) return status;
    const facts = toGitHubPullRequestFacts(
      GitHubPullRequestFactsGraphqlSchema.parse({
        data: {
          repository: {
            ...parsed.repository,
            pullRequest,
          },
        },
      }),
    );
    return facts ? { ...status, forgeSpecific: { forge: "github", ...facts } } : status;
  }

  function getPollTargetKey(target: {
    cwd: string;
    headRef: string;
    headSha?: string;
    headRepositoryOwner?: string;
  }): string {
    return buildCacheKey({
      cwd: target.cwd,
      method: "getCurrentPullRequestStatus",
      args: {
        headRef: target.headRef,
        headSha: target.headSha,
        headRepositoryOwner: target.headRepositoryOwner,
      },
    });
  }

  function schedulePoll(target: GitHubPollTarget, delayMs?: number): void {
    if (target.retainCount <= 0) return;
    if (target.timer) clearTimeout(target.timer);
    target.timer = setTimeout(
      () => {
        target.timer = null;
        void runPoll(target);
      },
      delayMs ?? computeGithubNextInterval(target.latestStatus, target.consecutiveErrors),
    );
  }

  async function runPoll(target: GitHubPollTarget): Promise<void> {
    try {
      await api.getCurrentPullRequestStatus({
        cwd: target.cwd,
        headRef: target.headRef,
        headSha: target.headSha,
        headRepositoryOwner: target.headRepositoryOwner,
        force: true,
        reason: "self-heal-github",
      });
    } catch (error) {
      target.consecutiveErrors += 1;
      for (const callback of target.errorCallbacks) callback(error);
      schedulePoll(target);
    }
  }

  function closePollTarget(target: GitHubPollTarget): void {
    if (target.timer) clearTimeout(target.timer);
    target.timer = null;
    target.retainCount = 0;
    target.callbacks.clear();
    target.errorCallbacks.clear();
  }

  async function resolveOperationRepository(input: {
    cwd: string;
    status?: PullRequestCommandStatus | null;
  }): Promise<GitHubRepositoryContext & { operationOwner: string; operationName: string }> {
    const repository = await repositoryContext(input.cwd);
    return {
      ...repository,
      operationOwner: input.status?.repoOwner ?? repository.owner,
      operationName: input.status?.repoName ?? repository.name,
    };
  }

  async function pullRequestNodeId(input: {
    repository: GitHubRepositoryContext;
    owner: string;
    name: string;
    number: number;
  }): Promise<string> {
    const response = await callGitHub(input.repository.host, "pull request node lookup", () =>
      input.repository.octokit.graphql(PULL_REQUEST_NODE_ID_QUERY, {
        owner: input.owner,
        name: input.name,
        number: input.number,
      }),
    );
    const parsed = PullRequestNodeIdGraphqlSchema.parse(response);
    const id = parsed.repository?.pullRequest?.id;
    if (!id) throw new Error(`Pull request #${input.number} was not found`);
    return id;
  }

  api = {
    authProbeCanThrow: true,

    listPullRequests(input) {
      return cached({
        cwd: input.cwd,
        method: "listPullRequests",
        args: { query: input.query ?? "", limit: input.limit ?? 20 },
        readOptions: input,
        load: () =>
          searchIssuesOrPullRequests({
            cwd: input.cwd,
            query: normalizeGitHubSearchQuery(input.query ?? "", null),
            limit: input.limit ?? 20,
            kind: "pull_request",
          }) as Promise<PullRequestSummary[]>,
      });
    },

    listIssues(input) {
      return cached({
        cwd: input.cwd,
        method: "listIssues",
        args: { query: input.query ?? "", limit: input.limit ?? 20 },
        readOptions: input,
        load: () =>
          searchIssuesOrPullRequests({
            cwd: input.cwd,
            query: normalizeGitHubSearchQuery(input.query ?? "", null),
            limit: input.limit ?? 20,
            kind: "issue",
          }) as Promise<IssueSummary[]>,
      });
    },

    getPullRequest(input) {
      return cached({
        cwd: input.cwd,
        method: "getPullRequest",
        args: { number: input.number },
        readOptions: input,
        load: async () => {
          const repository = await repositoryContext(input.cwd);
          const response = await callGitHub(repository.host, "pull request lookup", () =>
            repository.octokit.graphql(PULL_REQUEST_SUMMARY_QUERY, {
              owner: repository.owner,
              name: repository.name,
              number: input.number,
            }),
          );
          const parsed = GitHubPullRequestGraphqlSchema.parse(response);
          const pullRequest = parsed.repository?.pullRequest;
          if (!pullRequest) throw new Error(`Pull request #${input.number} was not found`);
          return toPullRequestSummary({
            ...pullRequest,
            labels: pullRequest.labels.nodes,
          });
        },
      });
    },

    async getPullRequestHeadRef(input) {
      return (await this.getPullRequest(input)).headRefName;
    },

    defaultCheckoutRefs({ changeRequestNumber }) {
      return [
        { remoteName: "origin", remoteRef: `refs/pull/${changeRequestNumber}/head` },
        { remoteName: "upstream", remoteRef: `refs/pull/${changeRequestNumber}/head` },
      ];
    },

    buildPrLocalBranchName({ headRef, checkoutTarget }) {
      const owner = checkoutTarget.isCrossRepository
        ? normalizeGitHubOwnerForBranch(checkoutTarget.headOwnerLogin)
        : null;
      return owner ? `${owner}/${headRef}` : headRef;
    },

    supportsCrossRepoCheckoutWithoutRefs: true,

    getPullRequestCheckoutTarget(input) {
      return cached({
        cwd: input.cwd,
        method: "getPullRequestCheckoutTarget",
        args: { number: input.number },
        readOptions: input,
        load: async () => {
          const repository = await repositoryContext(input.cwd);
          const response = await callGitHub(repository.host, "pull request checkout target", () =>
            repository.octokit.graphql(PULL_REQUEST_CHECKOUT_TARGET_QUERY, {
              owner: repository.owner,
              name: repository.name,
              number: input.number,
            }),
          );
          return toPullRequestCheckoutTarget(
            PullRequestCheckoutTargetSchema.parse({ data: response }),
          );
        },
      });
    },

    getCurrentPullRequestStatus(input) {
      return cached({
        cwd: input.cwd,
        method: "getCurrentPullRequestStatus",
        args: {
          headRef: input.headRef,
          headSha: input.headSha,
          headRepositoryOwner: input.headRepositoryOwner,
        },
        readOptions: input,
        load: () => currentPullRequestStatus(input),
      }).then((status) => {
        const target = pollTargets.get(getPollTargetKey(input));
        if (target) {
          target.latestStatus = status;
          target.consecutiveErrors = 0;
          if (input.reason === "self-heal-github") {
            for (const callback of target.callbacks) callback(status);
          }
          schedulePoll(target);
        }
        return status;
      });
    },

    getPullRequestTimeline(input) {
      return cached({
        cwd: input.cwd,
        method: "getPullRequestTimeline",
        args: { prNumber: input.prNumber },
        readOptions: input,
        load: async () => {
          try {
            const { host, octokit } = await clients.forCwd(input.cwd);
            const response = await callGitHub(host, "pull request timeline", () =>
              octokit.graphql(PULL_REQUEST_TIMELINE_QUERY, {
                owner: input.repoOwner,
                name: input.repoName,
                number: input.prNumber,
              }),
            );
            return toPullRequestTimeline(
              PullRequestTimelineGraphqlSchema.parse({ data: response }),
              {
                prNumber: input.prNumber,
                repoOwner: input.repoOwner,
                repoName: input.repoName,
              },
            );
          } catch (error) {
            return {
              prNumber: input.prNumber,
              repoOwner: input.repoOwner,
              repoName: input.repoName,
              items: [],
              truncated: false,
              error: mapPullRequestTimelineError(error),
            };
          }
        },
      });
    },

    getCheckDetails(input) {
      const { repoOwner, repoName, checkRunId } = input;
      if (!repoOwner || !repoName) {
        throw new Error("GitHub getCheckDetails requires repoOwner and repoName");
      }
      if (checkRunId === undefined) {
        throw new Error("GitHub getCheckDetails requires checkRunId");
      }
      return cached({
        cwd: input.cwd,
        method: "getCheckDetails",
        args: { repoOwner, repoName, checkRunId, workflowRunId: input.workflowRunId },
        readOptions: input,
        load: async () => {
          const { host, octokit } = await clients.forCwd(input.cwd);
          const checkRunResponse = await callGitHub(host, "check run lookup", () =>
            octokit.rest.checks.get({
              owner: repoOwner,
              repo: repoName,
              check_run_id: checkRunId,
            }),
          );
          const checkRun = toGitHubCheckRunDetails(
            GitHubCheckRunDetailsSchema.parse(checkRunResponse.data),
          );
          const annotationResponse = await callGitHub(host, "check annotations", () =>
            octokit.rest.checks.listAnnotations({
              owner: repoOwner,
              repo: repoName,
              check_run_id: checkRunId,
              per_page: CHECK_ANNOTATION_PAGE_MAX,
            }),
          );
          const annotations = toGitHubCheckAnnotations(
            GitHubCheckAnnotationsSchema.parse(annotationResponse.data),
          );
          const workflowRunId = input.workflowRunId ?? checkRun.workflowRunId ?? null;
          const failedJobs: CheckFailedJob[] = [];
          let truncated = annotations.length >= CHECK_ANNOTATION_PAGE_MAX;
          if (typeof workflowRunId === "number") {
            const jobsResponse = await callGitHub(host, "workflow jobs", () =>
              octokit.rest.actions.listJobsForWorkflowRun({
                owner: repoOwner,
                repo: repoName,
                run_id: workflowRunId,
                per_page: ACTIONS_JOB_PAGE_MAX,
              }),
            );
            const jobs = toGitHubActionsJobs(GitHubActionsJobsSchema.parse(jobsResponse.data));
            const failed = jobs.filter(isFailedActionsJob);
            truncated ||= jobs.length >= ACTIONS_JOB_PAGE_MAX;
            truncated ||= failed.length > FAILED_CHECK_JOB_LIMIT;
            for (const job of failed.slice(0, FAILED_CHECK_JOB_LIMIT)) {
              const key = `${job.jobId}:${job.completedAt ?? ""}`;
              let log = checkLogTailCache.get(key);
              if (!log) {
                const logResponse = await callGitHub(host, "workflow job logs", () =>
                  octokit.rest.actions.downloadJobLogsForWorkflowRun({
                    owner: repoOwner,
                    repo: repoName,
                    job_id: job.jobId,
                  }),
                );
                log = capCheckLogTail(githubLogBodyToString(logResponse.data));
                checkLogTailCache.set(key, log);
                while (checkLogTailCache.size > CHECK_LOG_TAIL_CACHE_MAX_ENTRIES) {
                  const oldestKey = checkLogTailCache.keys().next().value;
                  if (!oldestKey) break;
                  checkLogTailCache.delete(oldestKey);
                }
              }
              truncated ||= log.logTruncated;
              failedJobs.push({ ...job, logTail: log.logTail, logTruncated: log.logTruncated });
            }
          }
          return {
            checkRunId: checkRun.checkRunId,
            workflowRunId,
            name: checkRun.name,
            status: checkRun.status,
            conclusion: checkRun.conclusion,
            url: checkRun.url,
            detailsUrl: checkRun.detailsUrl,
            output: checkRun.output,
            annotations,
            failedJobs,
            truncated,
          };
        },
      });
    },

    async searchRepositories(input) {
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
      const query = input.query.trim();
      const { host, octokit } = await clients.forHost("github.com");
      if (query.length === 0) {
        const response = await callGitHub(host, "repository list", () =>
          octokit.rest.repos.listForAuthenticatedUser({
            sort: "updated",
            direction: "desc",
            per_page: limit,
            affiliation: "owner,collaborator,organization_member",
          }),
        );
        return response.data.map(toRepositorySummary);
      }
      const response = await callGitHub(host, "repository search", () =>
        octokit.rest.search.repos({ q: query, sort: "updated", order: "desc", per_page: limit }),
      );
      return response.data.items.map(toRepositorySummary);
    },

    async searchIssuesAndPrs(input) {
      if (input.force && !input.reason) {
        throw new Error("ForgeService forced read requires a reason");
      }
      const kinds = normalizeForgeSearchKinds(input.kinds);
      const readOptions: ForgeReadOptions = input.force
        ? { force: true, reason: input.reason }
        : { force: false, reason: input.reason };
      const host = await clients.resolveHost(input.cwd).catch(() => "github.com");
      const query = normalizeGitHubSearchQuery(input.query, host === "github.com" ? null : host);
      const [issuesResult, pullRequestsResult] = await Promise.allSettled([
        kinds.includes("issue")
          ? this.listIssues({ cwd: input.cwd, query, limit: input.limit, ...readOptions })
          : Promise.resolve(null),
        kinds.includes("change_request")
          ? this.listPullRequests({ cwd: input.cwd, query, limit: input.limit, ...readOptions })
          : Promise.resolve(null),
      ]);
      const requested = [issuesResult, pullRequestsResult].filter(
        (result) => result.status === "rejected" || result.value !== null,
      );
      if (
        requested.length > 0 &&
        requested.every(
          (result) =>
            result.status === "rejected" &&
            (result.reason instanceof GitHubAuthenticationError ||
              result.reason instanceof GitHubHostNotConfiguredError),
        )
      ) {
        return createUnavailableSearchResult("unauthenticated");
      }
      if (requested.length > 0 && requested.every((result) => result.status === "rejected")) {
        const firstFailure = requested.find((result) => result.status === "rejected");
        if (firstFailure?.status === "rejected") throw firstFailure.reason;
      }
      const items: SearchResult["items"] = [];
      if (issuesResult.status === "fulfilled") {
        for (const item of issuesResult.value ?? []) {
          items.push({
            kind: "issue",
            number: item.number,
            title: item.title,
            url: item.url,
            state: item.state,
            body: item.body,
            labels: item.labels,
            baseRefName: null,
            headRefName: null,
            updatedAt: item.updatedAt,
          });
        }
      }
      if (pullRequestsResult.status === "fulfilled") {
        for (const item of pullRequestsResult.value ?? []) {
          items.push({
            kind: "change_request",
            number: item.number,
            title: item.title,
            url: item.url,
            state: item.state,
            body: item.body,
            labels: item.labels,
            baseRefName: item.baseRefName,
            headRefName: item.headRefName,
            updatedAt: item.updatedAt,
          });
        }
      }
      items.sort(
        (left, right) =>
          parseOptionalTime(right.updatedAt ?? null) - parseOptionalTime(left.updatedAt ?? null),
      );
      return {
        items,
        featuresEnabled: true,
        authState: "authenticated",
        githubFeaturesEnabled: true,
      };
    },

    async createPullRequest(input) {
      const repository = await repositoryContext(input.cwd);
      const response = await callGitHub(repository.host, "pull request creation", () =>
        repository.octokit.rest.pulls.create({
          owner: repository.owner,
          repo: repository.name,
          title: input.title,
          head: input.head,
          base: input.base,
          ...(input.body ? { body: input.body } : {}),
        }),
      );
      return { url: response.data.html_url, number: response.data.number };
    },

    async mergePullRequest(input) {
      assertDirectPullRequestMergeReady(input);
      const repository = await resolveOperationRepository(input);
      const response = await callGitHub(repository.host, "pull request merge", () =>
        repository.octokit.rest.pulls.merge({
          owner: repository.operationOwner,
          repo: repository.operationName,
          pull_number: input.prNumber,
          merge_method: input.mergeMethod,
        }),
      );
      if (!response.data.merged) {
        throw new GitHubApiError({
          message: response.data.message || `GitHub did not merge pull request #${input.prNumber}`,
          cause: response.data,
        });
      }
      return { success: true };
    },

    async enablePullRequestAutoMerge(input) {
      assertPullRequestAutoMergeEnableReady(input);
      const repository = await resolveOperationRepository(input);
      const pullRequestId = await pullRequestNodeId({
        repository,
        owner: repository.operationOwner,
        name: repository.operationName,
        number: input.prNumber,
      });
      await callGitHub(repository.host, "enable pull request auto-merge", () =>
        repository.octokit.graphql(ENABLE_PULL_REQUEST_AUTO_MERGE_MUTATION, {
          pullRequestId,
          mergeMethod: input.mergeMethod.toUpperCase(),
        }),
      );
      return { success: true };
    },

    async disablePullRequestAutoMerge(input) {
      assertPullRequestAutoMergeDisableReady(input);
      const repository = await resolveOperationRepository(input);
      const pullRequestId = await pullRequestNodeId({
        repository,
        owner: repository.operationOwner,
        name: repository.operationName,
        number: input.prNumber,
      });
      await callGitHub(repository.host, "disable pull request auto-merge", () =>
        repository.octokit.graphql(DISABLE_PULL_REQUEST_AUTO_MERGE_MUTATION, {
          pullRequestId,
        }),
      );
      return { success: true };
    },

    isAuthenticated(input) {
      return cached({
        cwd: input.cwd,
        method: "isAuthenticated",
        args: {},
        readOptions: input,
        load: async () => {
          const { host, octokit } = await clients.forCwd(input.cwd);
          await callGitHub(host, "authentication check", () =>
            octokit.rest.users.getAuthenticated(),
          );
          return true;
        },
      });
    },

    isConfiguredHost(host) {
      return clients.isConfiguredHost(host);
    },
    retainCurrentPullRequestStatusPoll(input) {
      const key = getPollTargetKey(input);
      let target = pollTargets.get(key);
      if (!target) {
        target = {
          cwd: input.cwd,
          headRef: input.headRef,
          headSha: input.headSha,
          headRepositoryOwner: input.headRepositoryOwner,
          retainCount: 0,
          timer: null,
          latestStatus: null,
          consecutiveErrors: 0,
          callbacks: new Set(),
          errorCallbacks: new Set(),
        };
        pollTargets.set(key, target);
      }
      const newlyRetained = target.retainCount === 0;
      target.retainCount += 1;
      if (input.onStatus) target.callbacks.add(input.onStatus);
      if (input.onError) target.errorCallbacks.add(input.onError);
      schedulePoll(target, newlyRetained ? 0 : undefined);
      let unsubscribed = false;
      return {
        unsubscribe: () => {
          if (unsubscribed) return;
          unsubscribed = true;
          if (input.onStatus) target.callbacks.delete(input.onStatus);
          if (input.onError) target.errorCallbacks.delete(input.onError);
          target.retainCount -= 1;
          if (target.retainCount > 0) return;
          closePollTarget(target);
          pollTargets.delete(key);
        },
      };
    },

    invalidate(input) {
      for (const [key, entry] of cache.entries()) {
        if (entry.cwd === input.cwd) cache.delete(key);
      }
      for (const [key, entry] of inFlight.entries()) {
        if (entry.cwd === input.cwd) inFlight.delete(key);
      }
      clients.invalidate();
    },

    async beginLogin(input) {
      const host = input.host ?? (input.cwd ? await clients.resolveHost(input.cwd) : "github.com");
      return auth.beginLogin(host);
    },

    async finishLogin(flowId) {
      const result = await auth.finishLogin(flowId);
      clients.invalidate(result.host);
      cache.clear();
      return result;
    },

    cancelLogin(flowId) {
      auth.cancelLogin(flowId);
    },

    async logout(input) {
      const host = input.host ?? (input.cwd ? await clients.resolveHost(input.cwd) : "github.com");
      await auth.logout(host);
      clients.invalidate(host);
      cache.clear();
      return host;
    },

    dispose() {
      for (const target of pollTargets.values()) closePollTarget(target);
      pollTargets.clear();
      auth.dispose();
      clients.invalidate();
    },
  };

  return api;
}

function normalizeGitHubOwnerForBranch(owner: string | null): string | null {
  const normalized = owner?.trim().toLowerCase() ?? "";
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

function getGithubStatusFacts(
  status: PullRequestCommandStatus | null | undefined,
): GitHubPullRequestStatusFacts | null {
  const forgeSpecific = status?.forgeSpecific;
  return isGitHubPullRequestStatusFacts(forgeSpecific) ? forgeSpecific : null;
}

function assertDirectPullRequestMergeReady(input: MergePullRequestOptions): void {
  const github = getGithubStatusFacts(input.status);
  if (!github) {
    throw new Error("GitHub merge facts are unavailable for this pull request");
  }

  if (!DIRECT_PULL_REQUEST_MERGE_STATE_ALLOWLIST.has(github.mergeStateStatus ?? "")) {
    throw new Error("GitHub does not report this pull request as ready for direct merge");
  }
  if (github.isMergeQueueEnabled || github.isInMergeQueue) {
    throw new Error("Direct merge is not available because this repository uses a merge queue");
  }
  if (github.autoMergeRequest !== null) {
    throw new Error("Direct merge is not available because auto-merge is already enabled");
  }
  if (!isPullRequestMergeMethodAllowed(github.repository, input.mergeMethod)) {
    throw new Error(`Direct merge is not available because ${input.mergeMethod} is disabled`);
  }
}

export function assertPullRequestAutoMergeEnableReady(
  input: Pick<EnablePullRequestAutoMergeOptions, "mergeMethod" | "status">,
): void {
  const github = getGithubStatusFacts(input.status);
  if (!github) {
    throw new Error("GitHub auto-merge facts are unavailable for this pull request");
  }

  if (github.mergeStateStatus !== "BLOCKED") {
    throw new Error("GitHub does not report this pull request as blocked for auto-merge");
  }
  if (!github.viewerCanEnableAutoMerge) {
    throw new Error("GitHub does not allow this viewer to enable auto-merge");
  }
  if (!github.repository.autoMergeAllowed) {
    throw new Error("Auto-merge is disabled for this repository");
  }
  if (!isPullRequestMergeMethodAllowed(github.repository, input.mergeMethod)) {
    throw new Error(`Auto-merge is not available because ${input.mergeMethod} is disabled`);
  }
  if (github.autoMergeRequest !== null) {
    throw new Error("Auto-merge is already enabled for this pull request");
  }
  if (github.isMergeQueueEnabled || github.isInMergeQueue) {
    throw new Error("Auto-merge is not available because this repository uses a merge queue");
  }
  if (input.status?.mergeable === "CONFLICTING") {
    throw new Error("Auto-merge is not available because this pull request has conflicts");
  }
}

export function assertPullRequestAutoMergeDisableReady(
  input: Pick<DisablePullRequestAutoMergeOptions, "status">,
): void {
  const github = getGithubStatusFacts(input.status);
  if (!github) {
    throw new Error("GitHub auto-merge facts are unavailable for this pull request");
  }

  if (github.autoMergeRequest === null) {
    throw new Error("Auto-merge is not enabled for this pull request");
  }
  if (!github.viewerCanDisableAutoMerge) {
    throw new Error("GitHub does not allow this viewer to disable auto-merge");
  }
  if (github.isMergeQueueEnabled || github.isInMergeQueue) {
    throw new Error("Auto-merge is not available because this repository uses a merge queue");
  }
}

export function isPullRequestMergeMethodAllowed(
  repository: GitHubPullRequestStatusFacts["repository"],
  method: PullRequestMergeMethod,
): boolean {
  if (method === "squash") {
    return repository.squashMergeAllowed;
  }
  if (method === "merge") {
    return repository.mergeCommitAllowed;
  }
  return repository.rebaseMergeAllowed;
}

export function computeGithubNextInterval(
  status: CurrentPullRequestStatus | null,
  consecutiveErrors: number,
): number {
  const baseInterval = isGitHubStatusPending(status)
    ? GITHUB_POLL_FAST_INTERVAL_MS
    : GITHUB_POLL_SLOW_INTERVAL_MS;
  if (consecutiveErrors <= 1) {
    return baseInterval;
  }

  return Math.min(baseInterval * 2 ** (consecutiveErrors - 1), GITHUB_POLL_ERROR_BACKOFF_CAP_MS);
}

function isGitHubStatusPending(status: CurrentPullRequestStatus | null): boolean {
  if (!status) {
    return false;
  }
  if (status.checksStatus === "pending") {
    return true;
  }
  return status.checks.some((check) => check.status === "pending");
}

/**
 * Unknown self-hosted remotes are never probed over the network. Production
 * injects configured GitHub Enterprise hosts into the forge resolver instead.
 */
export async function probeGitHubHost(_host: string): Promise<boolean> {
  return false;
}

// Anchored to github.com so a pasted URL from an unrelated tracker (a GitLab
// or Gitea link that happens to share the /owner/repo/(pull|issues)/N shape)
// passes through as literal search text instead of being misread as a number.
// The workspace's resolved GitHub Enterprise host (if any) is accepted too.
const GITHUB_COM_ISSUE_OR_PR_URL_PATTERN =
  /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:pull|issues)\/(\d+)(?:[/?#].*)?$/i;

function buildEnterpriseIssueOrPrUrlPattern(host: string): RegExp {
  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^https?://${escapedHost}/[^/\\s]+/[^/\\s]+/(?:pull|issues)/(\\d+)(?:[/?#].*)?$`,
    "i",
  );
}

function normalizeGitHubSearchQuery(query: string, enterpriseHost: string | null): string {
  const trimmed = query.trim();
  const cloudMatch = trimmed.match(GITHUB_COM_ISSUE_OR_PR_URL_PATTERN);
  if (cloudMatch) {
    return cloudMatch[1];
  }
  if (enterpriseHost) {
    const enterpriseMatch = trimmed.match(buildEnterpriseIssueOrPrUrlPattern(enterpriseHost));
    if (enterpriseMatch) {
      return enterpriseMatch[1];
    }
  }
  return query;
}

function isStatusCheckRollupUnavailable(error: unknown): boolean {
  return (
    error instanceof GitHubApiError && error.message.toLowerCase().includes("statuscheckrollup")
  );
}

function buildCacheKey(params: { cwd: string; method: string; args: unknown }): string {
  return `${params.cwd}:${params.method}:${stableStringify(params.args)}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const sorted: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    sorted[key] = sortJsonValue(entryValue);
  }
  return sorted;
}

async function resolveGitHubSlugFromOrigin(cwd: string): Promise<string | null> {
  let stdout: string;
  try {
    ({ stdout } = await runGitCommand(["config", "--get", "remote.origin.url"], {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      timeout: GIT_ORIGIN_URL_READ_TIMEOUT_MS,
    }));
  } catch {
    return null;
  }
  const location = parseGitRemoteLocation(stdout.trim());
  return location ? (parseGitHubRemoteIdentity(location.path)?.repo ?? null) : null;
}

function toGitHubPullRequestFacts(
  parsed: z.infer<typeof GitHubPullRequestFactsGraphqlSchema>,
): GitHubPullRequestStatusFacts | null {
  const repository = parsed.data.repository;
  const pullRequest = repository?.pullRequest;
  if (!repository || !pullRequest) return null;
  return {
    mergeStateStatus: pullRequest.mergeStateStatus ?? null,
    autoMergeRequest: toGitHubAutoMergeRequest(pullRequest.autoMergeRequest),
    viewerCanEnableAutoMerge: pullRequest.viewerCanEnableAutoMerge ?? false,
    viewerCanDisableAutoMerge: pullRequest.viewerCanDisableAutoMerge ?? false,
    viewerCanMergeAsAdmin: pullRequest.viewerCanMergeAsAdmin ?? false,
    viewerCanUpdateBranch: pullRequest.viewerCanUpdateBranch ?? false,
    repository: toGitHubRepositoryMergePolicy(repository),
    isMergeQueueEnabled: pullRequest.isMergeQueueEnabled ?? false,
    isInMergeQueue: pullRequest.isInMergeQueue ?? false,
  };
}

function toGitHubAutoMergeRequest(
  request: GitHubPullRequestFactsPullRequest["autoMergeRequest"],
): GitHubPullRequestStatusFacts["autoMergeRequest"] {
  if (!request) {
    return null;
  }
  return {
    enabledAt: request.enabledAt ?? null,
    mergeMethod: request.mergeMethod ?? null,
    enabledBy: request.enabledBy?.login ?? null,
  };
}

function toGitHubRepositoryMergePolicy(
  repository: GitHubPullRequestFactsRepository,
): GitHubPullRequestStatusFacts["repository"] {
  return {
    autoMergeAllowed: repository.autoMergeAllowed ?? false,
    mergeCommitAllowed: repository.mergeCommitAllowed ?? false,
    squashMergeAllowed: repository.squashMergeAllowed ?? false,
    rebaseMergeAllowed: repository.rebaseMergeAllowed ?? false,
    viewerDefaultMergeMethod: repository.viewerDefaultMergeMethod ?? null,
  };
}

function isCandidateForHeadRef(candidate: ResolvedPullRequestCandidate, headRef: string): boolean {
  return candidate.status.headRefName === headRef && hasResolvedRepoIdentity(candidate.status);
}

function hasResolvedRepoIdentity(status: CurrentPullRequestStatus): boolean {
  return Boolean(status.repoOwner && status.repoName);
}

function pickPullRequestCandidate(options: {
  candidates: ResolvedPullRequestCandidate[];
  headRef: string;
  headSha?: string;
  headRepositoryOwner?: string;
}): ResolvedPullRequestCandidate | null {
  const matching = options.candidates.filter((candidate) => {
    if (!isCandidateForHeadRef(candidate, options.headRef)) {
      return false;
    }
    if (
      candidate.status.state !== "open" &&
      (!options.headSha || candidate.headSha !== options.headSha)
    ) {
      return false;
    }
    if (!options.headRepositoryOwner) {
      return true;
    }
    return (
      candidate.headRepositoryOwner?.toLowerCase() === options.headRepositoryOwner.toLowerCase()
    );
  });
  matching.sort((left, right) =>
    comparePullRequestCandidatePreference(left, right, options.headSha),
  );
  return matching[0] ?? null;
}

function comparePullRequestCandidatePreference(
  left: ResolvedPullRequestCandidate,
  right: ResolvedPullRequestCandidate,
  headSha?: string,
): number {
  const stateRank = getPullRequestStateRank(left.status) - getPullRequestStateRank(right.status);
  if (stateRank !== 0) {
    return stateRank;
  }
  const leftExact = headSha !== undefined && left.headSha === headSha;
  const rightExact = headSha !== undefined && right.headSha === headSha;
  if (leftExact !== rightExact) {
    return leftExact ? -1 : 1;
  }
  return 0;
}

function getPullRequestStateRank(status: CurrentPullRequestStatus): number {
  if (status.state === "open" || status.isDraft) {
    return 0;
  }
  if (status.state === "merged") {
    return 1;
  }
  return 2;
}

function toRepositorySummary(repository: {
  id: string | number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  visibility?: string;
  updated_at: string | null;
  clone_url: string;
}): GitHubRepositorySummary {
  const nameWithOwner = repository.full_name.trim();
  if (!nameWithOwner.includes("/")) {
    throw new Error(`GitHub repository is missing owner identity: ${nameWithOwner}`);
  }
  const visibility =
    repository.visibility === "internal" ? "internal" : repository.private ? "private" : "public";
  return {
    id: String(repository.id),
    name: repository.name.trim(),
    nameWithOwner,
    description: repository.description,
    visibility,
    updatedAt: repository.updated_at ?? "",
    cloneUrl: repository.clone_url,
  };
}

function toPullRequestCheckoutTarget(
  parsed: z.infer<typeof PullRequestCheckoutTargetSchema>,
): PullRequestCheckoutTarget {
  const pullRequest = parsed.data.repository.pullRequest;
  if (!pullRequest) {
    throw new Error("Pull request not found");
  }
  return {
    number: pullRequest.number,
    baseRefName: pullRequest.baseRefName,
    headRefName: pullRequest.headRefName,
    checkoutRefs: [
      { remoteName: "origin", remoteRef: `refs/pull/${pullRequest.number}/head` },
      { remoteName: "upstream", remoteRef: `refs/pull/${pullRequest.number}/head` },
    ],
    headOwnerLogin: pullRequest.headRepositoryOwner?.login || null,
    headRepositorySshUrl: pullRequest.headRepository?.sshUrl || null,
    headRepositoryUrl: pullRequest.headRepository?.url || null,
    isCrossRepository: pullRequest.isCrossRepository,
  };
}

function toPullRequestSummary(
  item: z.infer<typeof GitHubPullRequestSummarySchema>,
): PullRequestSummary {
  return {
    number: item.number,
    title: item.title,
    url: item.url,
    state: item.state,
    body: item.body,
    baseRefName: item.baseRefName,
    headRefName: item.headRefName,
    labels: item.labels.map((label) => label.name ?? "").filter((name) => name.length > 0),
    updatedAt: item.updatedAt,
  };
}

function toIssueSummary(item: z.infer<typeof GitHubIssueSummarySchema>): IssueSummary {
  return {
    number: item.number,
    title: item.title,
    url: item.url,
    state: item.state,
    body: item.body,
    labels: item.labels.map((label) => label.name ?? "").filter((name) => name.length > 0),
    updatedAt: item.updatedAt,
  };
}

function toPullRequestTimeline(
  parsed: z.infer<typeof PullRequestTimelineGraphqlSchema>,
  identity: { prNumber: number; repoOwner: string; repoName: string },
): PullRequestTimeline {
  const pullRequest = parsed.data?.repository?.pullRequest;
  const reviewThreadItems = pullRequest
    ? pullRequest.reviewThreads.nodes.flatMap(toPullRequestTimelineReviewThreadItems)
    : [];
  const reviewThreadItemIds = new Set(
    reviewThreadItems.map((item) => item.id).filter((id) => id.length > 0),
  );
  const items = pullRequest
    ? [
        ...pullRequest.reviews.nodes.flatMap(toPullRequestTimelineReviewItem),
        ...pullRequest.comments.nodes
          .filter((comment) => !reviewThreadItemIds.has(comment.id))
          .map(toPullRequestTimelineCommentItem),
        ...reviewThreadItems,
      ].sort(compareTimelineItems)
    : [];
  return {
    prNumber: pullRequest?.number ?? identity.prNumber,
    repoOwner: identity.repoOwner,
    repoName: identity.repoName,
    items,
    // S3 deliberately caps timeline fetches at the first 100 reviews, comments, and review threads.
    truncated: Boolean(
      pullRequest?.reviews.pageInfo.hasNextPage ||
      pullRequest?.comments.pageInfo.hasNextPage ||
      pullRequest?.reviewThreads.pageInfo.hasNextPage ||
      pullRequest?.reviewThreads.nodes.some((thread) => thread.comments.pageInfo.hasNextPage),
    ),
    error: pullRequest ? null : { kind: "not_found", message: "Pull request not found" },
  };
}

function toPullRequestTimelineReviewItem(
  review: z.infer<typeof PullRequestTimelineReviewNodeSchema>,
): PullRequestTimelineItem[] {
  const reviewState = mapTimelineReviewState(review.state, review.body ?? "");
  if (!reviewState) {
    return [];
  }
  return [
    {
      kind: "review",
      id: review.id,
      author: review.author?.login ?? "unknown",
      authorUrl: review.author?.url ?? null,
      avatarUrl: review.author?.avatarUrl ?? null,
      body: normalizeGitHubTimelineBody(review.body ?? "", review.bodyHTML ?? ""),
      createdAt: parseOptionalTime(review.submittedAt ?? null),
      url: review.url,
      reviewState,
    },
  ];
}

function toPullRequestTimelineCommentItem(
  comment: z.infer<typeof PullRequestTimelineCommentNodeSchema>,
): PullRequestTimelineItem {
  return {
    kind: "comment",
    id: comment.id,
    author: comment.author?.login ?? "unknown",
    authorUrl: comment.author?.url ?? null,
    avatarUrl: comment.author?.avatarUrl ?? null,
    body: normalizeGitHubTimelineBody(comment.body ?? "", comment.bodyHTML ?? ""),
    createdAt: parseOptionalTime(comment.createdAt ?? null),
    url: comment.url,
  };
}

interface ImageSourceReference {
  src: string;
  start: number;
  end: number;
}

const RAW_MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/g;
const HTML_IMAGE_RE = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
const GITHUB_RENDERED_IMAGE_HOSTS = new Set([
  "camo.githubusercontent.com",
  "private-user-images.githubusercontent.com",
]);

function normalizeGitHubTimelineBody(body: string, bodyHTML: string): string {
  const rawImages = extractRawImageSourceReferences(body);
  if (rawImages.length === 0) {
    return body;
  }

  const renderedSources = extractRenderedImageSources(bodyHTML);
  if (renderedSources.length !== rawImages.length) {
    return body;
  }

  let cursor = 0;
  let normalized = "";
  for (let index = 0; index < rawImages.length; index += 1) {
    const rawImage = rawImages[index];
    const renderedSrc = renderedSources[index];
    if (
      !rawImage ||
      !renderedSrc ||
      !isRawGitHubAttachmentSource(rawImage.src) ||
      !isGitHubRenderedImageSource(renderedSrc)
    ) {
      return body;
    }
    normalized += body.slice(cursor, rawImage.start);
    normalized += renderedSrc;
    cursor = rawImage.end;
  }
  normalized += body.slice(cursor);
  return normalized;
}

function extractRawImageSourceReferences(source: string): ImageSourceReference[] {
  const references = [
    ...extractHtmlImageSourceReferences(source),
    ...extractMarkdownImageSourceReferences(source),
  ];
  return references.sort((left, right) => left.start - right.start);
}

function extractRenderedImageSources(source: string): string[] {
  return extractHtmlImageSourceReferences(source).map((reference) => reference.src);
}

function extractHtmlImageSourceReferences(source: string): ImageSourceReference[] {
  const references: ImageSourceReference[] = [];
  HTML_IMAGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_IMAGE_RE.exec(source)) !== null) {
    const src = decodeHtmlAttribute(match[2] ?? "");
    if (!src) {
      continue;
    }
    const rawAttributeSrc = match[2] ?? "";
    const start = match.index + match[0].indexOf(rawAttributeSrc);
    references.push({ src, start, end: start + rawAttributeSrc.length });
  }
  return references;
}

function extractMarkdownImageSourceReferences(source: string): ImageSourceReference[] {
  const references: ImageSourceReference[] = [];
  RAW_MARKDOWN_IMAGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RAW_MARKDOWN_IMAGE_RE.exec(source)) !== null) {
    const src = match[1] ?? "";
    if (!src) {
      continue;
    }
    const start = match.index + match[0].indexOf(src);
    references.push({ src, start, end: start + src.length });
  }
  return references;
}

function isRawGitHubAttachmentSource(src: string): boolean {
  try {
    const url = new URL(src);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith("/user-attachments/assets/")
    );
  } catch {
    return false;
  }
}

function isGitHubRenderedImageSource(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && GITHUB_RENDERED_IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function toPullRequestTimelineReviewThreadItems(
  thread: z.infer<typeof PullRequestReviewThreadNodeSchema>,
): PullRequestTimelineItem[] {
  return thread.comments.nodes.map((comment) => ({
    ...toPullRequestTimelineCommentItem(comment),
    ...(comment.pullRequestReview?.id ? { reviewId: comment.pullRequestReview.id } : {}),
    location: {
      path: thread.path,
      ...(thread.line !== null && thread.line !== undefined ? { line: thread.line } : {}),
      ...(thread.startLine !== null && thread.startLine !== undefined
        ? { startLine: thread.startLine }
        : {}),
      ...(thread.id ? { threadId: thread.id } : {}),
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
    },
  }));
}

function toGitHubCheckRunDetails(
  parsed: z.infer<typeof GitHubCheckRunDetailsSchema>,
): CheckDetails {
  return {
    checkRunId: parsed.id,
    workflowRunId: parsed.check_suite?.workflow_run?.id ?? null,
    name: parsed.name,
    status: parsed.status,
    conclusion: parsed.conclusion,
    url: parsed.html_url,
    detailsUrl: parsed.details_url,
    output: parsed.output,
    annotations: [],
    failedJobs: [],
    truncated: false,
  };
}

function toGitHubCheckAnnotations(
  annotations: z.infer<typeof GitHubCheckAnnotationsSchema>,
): CheckAnnotation[] {
  return annotations.map((annotation) => {
    const result: CheckAnnotation = {};
    if (annotation.path) result.path = annotation.path;
    if (annotation.start_line !== undefined) result.startLine = annotation.start_line;
    if (annotation.end_line !== undefined) result.endLine = annotation.end_line;
    if (annotation.annotation_level) result.annotationLevel = annotation.annotation_level;
    if (annotation.message) result.message = annotation.message;
    if (annotation.title) result.title = annotation.title;
    if (annotation.raw_details) result.rawDetails = annotation.raw_details;
    return result;
  });
}

function toGitHubActionsJobs(parsed: z.infer<typeof GitHubActionsJobsSchema>): CheckFailedJob[] {
  return parsed.jobs.map((job) => {
    const result: CheckFailedJob = {
      jobId: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      url: job.html_url,
    };
    if (job.completed_at) result.completedAt = job.completed_at;
    return result;
  });
}

function isFailedActionsJob(job: CheckFailedJob): boolean {
  return (
    job.conclusion === "failure" ||
    job.conclusion === "cancelled" ||
    job.conclusion === "timed_out" ||
    job.conclusion === "action_required"
  );
}

function githubLogBodyToString(body: unknown): string {
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  }
  throw new Error("GitHub returned an unsupported workflow log response");
}

function capCheckLogTail(log: string): { logTail: string; logTruncated: boolean } {
  const lines = log.split("\n");
  let truncated = lines.length > CHECK_LOG_TAIL_MAX_LINES;
  let tail = lines.slice(-CHECK_LOG_TAIL_MAX_LINES).join("\n");

  if (Buffer.byteLength(tail, "utf8") > CHECK_LOG_TAIL_MAX_BYTES) {
    truncated = true;
    tail = utf8SuffixWithinBytes(tail, CHECK_LOG_TAIL_MAX_BYTES);
  }

  return { logTail: tail, logTruncated: truncated };
}

function utf8SuffixWithinBytes(value: string, maxBytes: number): string {
  let lowerBound = 0;
  let upperBound = value.length;

  while (lowerBound < upperBound) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    if (Buffer.byteLength(value.slice(midpoint), "utf8") > maxBytes) {
      lowerBound = midpoint + 1;
    } else {
      upperBound = midpoint;
    }
  }

  return value.slice(lowerBound);
}

function mapTimelineReviewState(
  state: string,
  body: string,
): PullRequestTimelineReviewState | null {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    case "DISMISSED":
    case "PENDING":
      return body.trim().length > 0 ? "commented" : null;
    default:
      return body.trim().length > 0 ? "commented" : null;
  }
}

function mapPullRequestTimelineError(error: unknown): PullRequestTimelineError {
  if (error instanceof GitHubAuthenticationError) {
    return { kind: "forbidden", message: error.stderr || error.message };
  }
  if (error instanceof GitHubApiError) {
    return {
      kind: error.status === 404 ? "not_found" : error.status === 403 ? "forbidden" : "unknown",
      message: error.message,
    };
  }
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

function toCurrentPullRequestStatus(
  item: CurrentPullRequestStatusItem,
  fallbackHeadRefName: string,
): CurrentPullRequestStatus | null {
  if (!item.url || !item.title) {
    return null;
  }
  const repoIdentity = parseGitHubPullRequestRepo(item.url);
  const mergedAt =
    typeof item.mergedAt === "string" && item.mergedAt.trim().length > 0 ? item.mergedAt : null;
  let state: string;
  if (mergedAt !== null) {
    state = "merged";
  } else if (item.state.trim().length > 0) {
    state = item.state.toLowerCase();
  } else {
    state = "";
  }
  const checks = parseStatusCheckRollup(item.statusCheckRollup);
  return {
    ...(typeof item.number === "number" ? { number: item.number } : {}),
    ...(repoIdentity ? { repoOwner: repoIdentity.owner, repoName: repoIdentity.name } : {}),
    url: item.url,
    title: item.title,
    state,
    baseRefName: item.baseRefName,
    headRefName: item.headRefName || fallbackHeadRefName,
    isMerged: mergedAt !== null,
    isDraft: item.isDraft ?? false,
    mergeable: item.mergeable,
    checks,
    checksStatus: computeChecksStatus(checks),
    reviewDecision: mapReviewDecision(item.reviewDecision),
  };
}

function parseGitHubPullRequestRepo(url: string): { owner: string; name: string } | null {
  try {
    const parsed = new URL(url);
    // Host-agnostic on purpose: a GitHub Enterprise PR URL carries the instance
    // host, and the owner/name still live in the same `/owner/name/pull/N` path.
    const [owner, name, kind] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !name || kind !== "pull") {
      return null;
    }
    return { owner, name };
  } catch {
    return null;
  }
}

export function parseStatusCheckRollup(value: unknown, nowMs = Date.now()): PullRequestCheck[] {
  const directContexts = PullRequestStatusCheckRollupArraySchema.safeParse(value);
  if (!directContexts.success) {
    const legacyContexts = LegacyPullRequestStatusCheckRollupSchema.safeParse(value);
    if (!legacyContexts.success) {
      return [];
    }
    return parseStatusCheckRollup(legacyContexts.data.contexts, nowMs);
  }

  const dedupedChecks = new Map<string, PullRequestCheck & { recency: number }>();
  for (const entry of directContexts.data) {
    const parsed = PullRequestStatusCheckRollupNodeSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const check = buildPullRequestCheck(parsed.data, nowMs);
    if (!check) {
      continue;
    }
    const existing = dedupedChecks.get(check.name);
    if (!existing || check.recency > existing.recency) {
      dedupedChecks.set(check.name, check);
    }
  }

  return Array.from(dedupedChecks.values(), ({ recency: _recency, ...check }) => check);
}

function buildPullRequestCheck(
  context: z.infer<typeof PullRequestStatusCheckRollupNodeSchema>,
  nowMs: number,
): (PullRequestCheck & { recency: number }) | null {
  if (context.__typename === "CheckRun") {
    return {
      name: context.name,
      status: mapCheckRunStatus(context.status, context.conclusion),
      url: typeof context.detailsUrl === "string" ? context.detailsUrl : null,
      ...(typeof context.workflowName === "string" && context.workflowName.trim().length > 0
        ? { workflow: context.workflowName }
        : {}),
      ...(typeof context.databaseId === "number" ? { checkRunId: context.databaseId } : {}),
      ...(typeof context.checkSuite?.workflowRun?.databaseId === "number"
        ? { workflowRunId: context.checkSuite.workflowRun.databaseId }
        : {}),
      ...formatCheckRunDuration(context, nowMs),
      recency: getCheckRunRecency(context),
    };
  }
  if (context.__typename === "StatusContext") {
    return {
      name: context.context,
      status: mapStatusContextState(context.state),
      url: typeof context.targetUrl === "string" ? context.targetUrl : null,
      recency: getStatusContextRecency(context),
    };
  }
  return null;
}

function mapCheckRunStatus(status: unknown, conclusion: unknown): PullRequestCheckStatus {
  if (status !== "COMPLETED") {
    return "pending";
  }
  switch (conclusion) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
      return "failure";
    case "CANCELLED":
      return "cancelled";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipped";
    default:
      return "pending";
  }
}

function mapStatusContextState(state: unknown): PullRequestCheckStatus {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "EXPECTED":
    case "PENDING":
      return "pending";
    default:
      return "pending";
  }
}

function getCheckRunRecency(context: PullRequestCheckRunNode): number {
  const workflowRunId = context.checkSuite?.workflowRun?.databaseId;
  if (typeof workflowRunId === "number") {
    return workflowRunId;
  }
  return parseOptionalTime(context.completedAt ?? context.startedAt ?? null);
}

/**
 * How long the check ran for. A finished run measures to its completion; a run still
 * going measures to now, so a client can say how long it has been waiting instead of
 * showing nothing. Raw timestamps never reach the client, so this is where the choice
 * between the two has to be made.
 */
function formatCheckRunDuration(
  context: PullRequestCheckRunNode,
  nowMs: number,
): { duration?: string } {
  const startedAt = parseOptionalTime(context.startedAt ?? null);
  if (startedAt <= 0) {
    return {};
  }
  const completedAt = parseOptionalTime(context.completedAt ?? null);
  const endedAt = completedAt > 0 ? completedAt : nowMs;
  if (endedAt < startedAt) {
    return {};
  }
  const durationSeconds = Math.floor((endedAt - startedAt) / 1_000);
  return { duration: formatDurationSeconds(durationSeconds) };
}

function formatDurationSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

function getStatusContextRecency(context: PullRequestStatusContextNode): number {
  return parseOptionalTime(context.createdAt ?? null);
}

function mapReviewDecision(value: unknown): PullRequestReviewDecision {
  const reviewDecision = PullRequestReviewDecisionSchema.parse(value);
  if (reviewDecision === "APPROVED") {
    return "approved";
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    return "changes_requested";
  }
  if (reviewDecision === "REVIEW_REQUIRED") {
    return "pending";
  }
  return null;
}

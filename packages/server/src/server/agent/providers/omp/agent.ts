import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setImmediate as waitForImmediate, setTimeout as delay } from "node:timers/promises";
import type { Logger } from "pino";
import stripAnsi from "strip-ansi";
import type {
  OmpCustomProviderInput,
  OmpInstallationStatus,
  OmpProviderAccountQuota,
} from "@omp-desktop/protocol/messages";
import { parseDocument } from "yaml";

import {
  type AgentCapabilityFlags,
  type OmpProviderManagement,
  type OmpProviderLoginStart,
  type AgentClient,
  type AgentFeature,
  type AgentLaunchContext,
  type AgentMetadata,
  type AgentMode,
  type AgentModelDefinition,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPermissionResult,
  type AgentProviderNotice,
  type AgentPersistenceHandle,
  type AgentPromptInput,
  type AgentProvider,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRuntimeInfo,
  type AgentSession,
  type AgentSessionConfig,
  type AgentSlashCommand,
  type AgentStreamEvent,
  type AgentTimelineItem,
  type FetchCatalogOptions,
  type ImportableProviderSession,
  type ImportProviderSessionContext,
  type ImportProviderSessionInput,
  type ListImportableSessionsOptions,
  type ProviderCatalog,
  type ProviderRefreshContext,
  type ToolCallDetail,
} from "../../agent-sdk-types.js";
import { writeFileAtomic } from "../../../atomic-file.js";
import type { PaseoToolCatalog } from "../../tools/types.js";
import { importSessionFromPersistence } from "../../provider-session-import.js";
import { runProviderRefreshActivity } from "../../provider-refresh-deadline.js";
import { runProviderTurn } from "../provider-runner.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
  type ResolvedProviderLaunch,
} from "../../provider-launch-config.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";
import { composeSystemPromptParts } from "../../system-prompt.js";
import {
  buildBinaryDiagnosticRows,
  buildCommandResolutionDiagnosticRows,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  toDiagnosticErrorMessage,
} from "../diagnostic-utils.js";
import {
  formatOmpVersionSupport,
  mergeOmpRuntimeSettings,
  resolveOmpDiagnosticPaths,
  resolveOmpLaunchMode,
  resolveOmpProviderParams,
  OMP_MODES,
  type OmpModelRoleParams,
  type OmpRuntimeProviderParams,
} from "./provider-config.js";
export { formatOmpVersionSupport, resolveOmpDiagnosticPaths } from "./provider-config.js";
import { OmpSubagentCardTracker, type OmpSubagentCardScheduler } from "./subagent-card-tracker.js";
import { shouldDisplayOmpCustomMessage } from "./custom-message.js";
import { getUserMessageText } from "./message-history.js";
import { mapOmpSystemNoticeToToolCall } from "./system-notice.js";
import { materializeProviderImage } from "../provider-image-output.js";
import { ensureManagedOmpOnPath, getOmpInstallationStatus, installOmp } from "./installer.js";
import { OmpCliRuntime } from "./cli-runtime.js";
import { listOmpImportableSessions, readOmpImportSessionConfig } from "./session-descriptor.js";
import type { OmpRuntime, OmpRuntimeSession, OmpStartSessionInput } from "./runtime.js";
import type {
  OmpAgentSessionEvent,
  OmpAgentMessage,
  OmpImageContent,
  OmpModel,
  OmpRuntimeEvent,
  OmpSessionState,
  OmpThinkingLevel,
} from "./rpc-types.js";
import {
  parseToolArgs,
  parseToolResult,
  resolveToolCallName,
  type OmpToolResult,
  type OmpTrackedToolCall,
} from "./tool-call-detail.js";
import { mapOmpAvailableCommandsUpdate, mapOmpRuntimeSlashCommands } from "./commands.js";
import { streamOmpHistory } from "./history.js";
import { mapOmpTodoReminderEvent, mapOmpTodoState, mapOmpTodoToolResult } from "./todo-mapper.js";
import { mapOmpRuntimeEventToTimelineItem } from "./event-mapper.js";
import { mapOmpAdvisorMessageToToolCall } from "./advisor-message.js";
import {
  clearOmpHostToolState,
  handleOmpHostToolRuntimeEvent,
  setOmpHostTools,
} from "./host-tools.js";
import { OmpSubagentIndex } from "./subagent-index.js";
import { mapOmpToolDetail } from "./tool-call-mapper.js";
import { OmpUsagePoller, type OmpUsagePollScheduler } from "./usage-poller.js";
import {
  buildOmpRpcUiPermissionResponse,
  mapOmpRpcUiPermissionRequest,
} from "./rpc-ui-permission-mapper.js";
import { DEFAULT_OMP_THINKING_LEVEL, mapOmpModel } from "./map-omp-model.js";
import { fetchCodexAccountQuota, type CodexAccountQuotaCredential } from "./codex-account-quota.js";

const OMP_PROVIDER = "omp";
const QUESTION_RESPONSE_HEADER = "Response";
const QUESTION_COMMENT_HEADER = "Comment";
const OMP_ASK_USER_FREEFORM_SENTINEL = "✏️ Type custom response...";
const COMBINED_ASK_USER_METADATA = "ask_user_select_optional_comment";
interface NodeSqliteStatement {
  all(...params: unknown[]): Array<Record<string, unknown>>;
  run(...params: unknown[]): { changes: number | bigint };
}
interface NodeSqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
}
export interface StoredOmpOAuthAccount {
  credentialId: number;
  provider: string;
  identityKey?: string;
}
interface StoredOmpOAuthAccountCredential
  extends StoredOmpOAuthAccount, CodexAccountQuotaCredential {}

function parseStoredOmpOAuthAccountCredential(
  row: Record<string, unknown>,
): StoredOmpOAuthAccountCredential | null {
  const credentialId = Number(row.id);
  if (
    !Number.isSafeInteger(credentialId) ||
    credentialId <= 0 ||
    typeof row.provider !== "string" ||
    row.provider.length === 0 ||
    typeof row.data !== "string"
  ) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const credential = data as Record<string, unknown>;
  const accessToken = typeof credential.access === "string" ? credential.access.trim() : "";
  if (!accessToken) return null;
  const identityKey =
    typeof row.identity_key === "string" && row.identity_key.trim().length > 0
      ? row.identity_key.trim()
      : undefined;
  const accountId =
    typeof credential.accountId === "string" && credential.accountId.trim().length > 0
      ? credential.accountId.trim()
      : undefined;
  return {
    credentialId,
    provider: row.provider,
    ...(identityKey ? { identityKey } : {}),
    accessToken,
    ...(accountId ? { accountId } : {}),
  };
}

export function readStoredOmpOAuthAccountCredentials(
  agentDbPath: string,
  providerId = "openai-codex",
): StoredOmpOAuthAccountCredential[] {
  if (!existsSync(agentDbPath)) return [];
  const database = openOmpCredentialDatabase(agentDbPath);
  try {
    const columns = new Set(
      database
        .prepare("PRAGMA table_info(auth_credentials)")
        .all()
        .map((row) => row.name)
        .filter((name): name is string => typeof name === "string"),
    );
    const requiredColumns = [
      "id",
      "provider",
      "credential_type",
      "data",
      "disabled_cause",
      "identity_key",
    ];
    if (requiredColumns.some((column) => !columns.has(column))) return [];
    return database
      .prepare(
        `SELECT id, provider, data, identity_key
         FROM auth_credentials
         WHERE provider = ? AND credential_type = 'oauth' AND disabled_cause IS NULL
         ORDER BY id`,
      )
      .all(providerId)
      .flatMap((row) => {
        const parsed = parseStoredOmpOAuthAccountCredential(row);
        return parsed ? [parsed] : [];
      });
  } finally {
    database.close();
  }
}

function openOmpCredentialDatabase(agentDbPath: string): NodeSqliteDatabase {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => NodeSqliteDatabase;
  };
  const database = new DatabaseSync(agentDbPath);
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

export function readStoredOmpOAuthAccounts(agentDbPath: string): StoredOmpOAuthAccount[] {
  if (!existsSync(agentDbPath)) return [];

  const database = openOmpCredentialDatabase(agentDbPath);
  try {
    const columns = new Set(
      database
        .prepare("PRAGMA table_info(auth_credentials)")
        .all()
        .map((row) => row.name)
        .filter((name): name is string => typeof name === "string"),
    );
    const requiredColumns = ["id", "provider", "credential_type", "disabled_cause", "identity_key"];
    if (requiredColumns.some((column) => !columns.has(column))) return [];

    return database
      .prepare(
        `SELECT id, provider, identity_key
         FROM auth_credentials
         WHERE credential_type = 'oauth' AND disabled_cause IS NULL
         ORDER BY provider, id`,
      )
      .all()
      .flatMap((row): StoredOmpOAuthAccount[] => {
        const credentialId = Number(row.id);
        if (
          !Number.isSafeInteger(credentialId) ||
          credentialId <= 0 ||
          typeof row.provider !== "string" ||
          row.provider.length === 0
        ) {
          return [];
        }
        const identityKey =
          typeof row.identity_key === "string" && row.identity_key.trim().length > 0
            ? row.identity_key.trim()
            : undefined;
        return [
          {
            credentialId,
            provider: row.provider,
            ...(identityKey ? { identityKey } : {}),
          },
        ];
      });
  } finally {
    database.close();
  }
}

export function disableStoredOmpProviderCredentials(
  agentDbPath: string,
  providerId: string,
): number {
  if (!existsSync(agentDbPath)) {
    throw new Error(`OMP credential database does not exist at ${agentDbPath}`);
  }
  const database = openOmpCredentialDatabase(agentDbPath);
  try {
    const result = database
      .prepare(
        `UPDATE auth_credentials
         SET disabled_cause = ?, updated_at = CAST(strftime('%s','now') AS INTEGER)
         WHERE provider = ? AND disabled_cause IS NULL`,
      )
      .run("deleted by user", providerId);
    return Number(result.changes);
  } finally {
    database.close();
  }
}

export function disableStoredOmpCredential(
  agentDbPath: string,
  providerId: string,
  credentialId: number,
): number {
  if (!Number.isSafeInteger(credentialId) || credentialId <= 0) {
    throw new Error(`Invalid OMP credential id '${credentialId}'`);
  }
  if (!existsSync(agentDbPath)) {
    throw new Error(`OMP credential database does not exist at ${agentDbPath}`);
  }
  const database = openOmpCredentialDatabase(agentDbPath);
  try {
    const result = database
      .prepare(
        `UPDATE auth_credentials
         SET disabled_cause = ?, updated_at = CAST(strftime('%s','now') AS INTEGER)
         WHERE id = ? AND provider = ? AND credential_type = 'oauth' AND disabled_cause IS NULL`,
      )
      .run("deleted by user", credentialId, providerId);
    return Number(result.changes);
  } finally {
    database.close();
  }
}

const OMP_CORE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

export interface OmpAgentClientOptions {
  oauthAccounts?: readonly StoredOmpOAuthAccount[];
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  providerParams?: unknown;
  runtime?: OmpRuntime;
  subagentCardScheduler?: OmpSubagentCardScheduler;
  providerIdleScheduler?: OmpProviderIdleScheduler;
  noTurnScheduler?: OmpNoTurnScheduler;
  usagePollScheduler?: OmpUsagePollScheduler;
  quotaFetch?: typeof fetch;
  quotaNow?: () => number;
}

export interface OmpProviderIdleScheduler {
  waitForRetry(): Promise<void>;
}

export interface OmpNoTurnScheduler {
  waitForSettle(signal: AbortSignal): Promise<void>;
}

// COMPAT(ompDelayedLocalOnlyResult): OMP 17.0.5 can report a regular prompt as
// local-only shortly before an extension-queued model turn starts. Added in
// v0.2.0-beta.1; remove after January 20, 2027 once the minimum OMP version
// guarantees prompt_result waits for queued extension work.
const OMP_NO_TURN_SETTLE_MS = 5_000;

interface OmpPromptPayload {
  text: string;
  images?: OmpImageContent[];
}

interface OmpModelReference {
  provider?: string;
  id: string;
}

interface OmpPersistenceMetadata {
  cwd?: string;
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  systemPrompt?: string;
}

interface StartTurnResult {
  turnId: string;
}

interface OmpAgentSessionOptions {
  oauthAccounts?: readonly StoredOmpOAuthAccount[];
  runtimeSession: OmpRuntimeSession;
  config: AgentSessionConfig;
  initialState: OmpSessionState;
  currentModeId?: string | null;
  logger: Logger;
  subagentCardScheduler?: OmpSubagentCardScheduler;
  providerIdleScheduler?: OmpProviderIdleScheduler;
  noTurnScheduler?: OmpNoTurnScheduler;
  usagePollScheduler?: OmpUsagePollScheduler;
  paseoTools?: PaseoToolCatalog;
  /**
   * When false (resumed sessions), replayed session events are dropped until
   * the first prompt or agent_start so history is not re-emitted as live
   * timeline items.
   */
  live?: boolean;
}

function createOmpProviderIdleScheduler(): OmpProviderIdleScheduler {
  return {
    waitForRetry: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}

function createOmpNoTurnScheduler(): OmpNoTurnScheduler {
  return {
    waitForSettle: async (signal) => {
      await delay(OMP_NO_TURN_SETTLE_MS, undefined, { signal });
    },
  };
}

interface OmpResumeConfig {
  cwd: string;
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  config: AgentSessionConfig;
}

interface ActiveAskUserDialog {
  allowComment: boolean;
  allowFreeform: boolean;
  allowMultiple: boolean;
}

interface PendingCombinedAskUserResponse {
  comment: string;
  freeform: string | null;
}

interface ExtensionUiMappingOptions {
  provider?: AgentProvider;
  label?: string;
  combineOptionalComment?: boolean;
  allowFreeform?: boolean;
}

interface OmpSlashCommandInvocation {
  commandName: string;
  args?: string;
}
const OMP_WORKFLOW_FEATURE_ID = "workflow_mode";
const OMP_OAUTH_ACCOUNT_FEATURE_ID = "oauth_account_credential";
const OMP_FAST_MODE_FEATURE_ID = "fast_mode";
const OMP_PLAN_APPROVAL_REQUEST_ID = "omp-plan-approval";
const OMP_PLAN_APPROVAL_REQUEST_NAME = "OmpPlanApproval";
type OmpWorkflowMode = "plan" | "goal";
type OmpWorkflowSelection = "standard" | OmpWorkflowMode;

function normalizeOmpWorkflowSelection(value: unknown): OmpWorkflowSelection {
  return value === "plan" || value === "goal" ? value : "standard";
}

function formatStoredOmpOAuthAccountLabel(account: StoredOmpOAuthAccount): string {
  const identityKey = account.identityKey?.trim();
  if (!identityKey) return `OAuth credential #${account.credentialId}`;
  const parts = identityKey
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const emailPart = parts.find((part) => part.toLowerCase().startsWith("email:"));
  if (!emailPart) return identityKey;
  const email = emailPart.slice(emailPart.indexOf(":") + 1).trim();
  if (!email) return identityKey;
  const qualifiers = parts.filter((part) => part !== emailPart);
  return qualifiers.length > 0 ? `${email} · ${qualifiers.join(" · ")}` : email;
}

function createOmpFeatures(
  config: AgentSessionConfig,
  oauthAccounts: readonly StoredOmpOAuthAccount[] = [],
  fastMode?: { supported: boolean; eligible: boolean; enabled: boolean },
): AgentFeature[] {
  const features: AgentFeature[] = [
    {
      type: "select",
      id: OMP_WORKFLOW_FEATURE_ID,
      label: "Workflow",
      description: "Choose an OMP-native conversation workflow independently from approvals.",
      icon: "Target",
      value: normalizeOmpWorkflowSelection(config.featureValues?.[OMP_WORKFLOW_FEATURE_ID]),
      options: [
        { id: "standard", label: "Standard" },
        { id: "plan", label: "Plan" },
        { id: "goal", label: "Goal" },
      ],
    },
  ];
  const modelProvider = parseModelReference(config.model ?? null)?.provider;
  if (fastMode?.supported && fastMode.eligible) {
    features.push({
      type: "toggle",
      id: OMP_FAST_MODE_FEATURE_ID,
      label: "Fast mode",
      description: "Use the model's priority service tier for lower latency.",
      tooltip: "Toggle fast mode.",
      icon: "zap",
      value: fastMode.enabled,
    });
  }
  const providerAccounts =
    modelProvider === "openai-codex"
      ? oauthAccounts.filter((account) => account.provider === modelProvider)
      : [];
  if (providerAccounts.length > 1) {
    const configuredCredentialId = optionalString(
      config.featureValues?.[OMP_OAUTH_ACCOUNT_FEATURE_ID],
    );
    features.push({
      type: "select",
      id: OMP_OAUTH_ACCOUNT_FEATURE_ID,
      label: "OAuth account",
      description: "Pin one stored OAuth account to this OMP session.",
      icon: "User",
      value:
        configuredCredentialId &&
        providerAccounts.some((account) => String(account.credentialId) === configuredCredentialId)
          ? configuredCredentialId
          : null,
      options: providerAccounts.map((account) => ({
        id: String(account.credentialId),
        label: formatStoredOmpOAuthAccountLabel(account),
      })),
    });
  }
  return features;
}

interface OmpProviderLoginFlow {
  providerId: string;
  runtimeSession: OmpRuntimeSession;
  unsubscribe: () => void;
  loginPromise: Promise<void>;
  inputRequestId?: string;
  completed: boolean;
  error?: Error;
  waitForActivity: Promise<void>;
  resolveActivity: () => void;
  timeout: NodeJS.Timeout;
}

type AutoCompactMode = boolean | "toggle" | "unknown";

function normalizeOmpModelLabel(label: string): string {
  const normalizedLabel = label.trim().replace(/[_\s]+/g, " ");
  const vendorSeparatorIndex = normalizedLabel.indexOf(": ");
  if (vendorSeparatorIndex === -1) {
    return normalizedLabel;
  }

  return normalizedLabel.slice(vendorSeparatorIndex + 2).trim();
}

export function transformOmpModels(models: AgentModelDefinition[]): AgentModelDefinition[] {
  return models.map((model) => {
    if (!model.label.includes("/")) {
      return model;
    }

    const segments = model.label.split("/").filter((segment) => segment.length > 0);
    const rawLabel = segments.at(-1);
    if (!rawLabel) {
      return model;
    }

    return {
      ...model,
      label: normalizeOmpModelLabel(rawLabel),
      description: model.description ?? model.label,
    };
  });
}

function isOmpThinkingLevel(value: string | null | undefined): value is OmpThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function normalizeOmpThinkingOption(value: string | null | undefined): OmpThinkingLevel | null {
  if (!value) {
    return null;
  }
  return isOmpThinkingLevel(value) ? value : null;
}

function parseAutoCompactMode(value: string | undefined): AutoCompactMode {
  const mode = (value ?? "toggle").trim().toLowerCase();
  if (mode === "on" || mode === "true" || mode === "enable" || mode === "enabled") {
    return true;
  }
  if (mode === "off" || mode === "false" || mode === "disable" || mode === "disabled") {
    return false;
  }
  if (mode === "toggle") {
    return "toggle";
  }
  return "unknown";
}

function ompModelSupportsImageInput(model: OmpModel | null | undefined): boolean {
  return model?.input?.includes("image") === true;
}

function renderTextOnlyImageHint(image: { data: string; mimeType: string }): string {
  try {
    const materialized = materializeProviderImage({
      data: image.data,
      mimeType: image.mimeType,
    });
    return `[Image available at: ${materialized.path}]`;
  } catch (error) {
    return `[Image attachment omitted: failed to write local file (${toDiagnosticErrorMessage(error)})]`;
  }
}

function convertPromptInput(
  prompt: AgentPromptInput,
  options: { model: OmpModel | null | undefined },
): OmpPromptPayload {
  if (typeof prompt === "string") {
    return { text: prompt };
  }

  const textParts: string[] = [];
  const images: OmpImageContent[] = [];
  const forwardImages = ompModelSupportsImageInput(options.model);

  for (const block of prompt) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }

    if (block.type === "image") {
      if (forwardImages) {
        images.push({
          type: "image",
          data: block.data,
          mimeType: block.mimeType,
        });
      } else {
        textParts.push(renderTextOnlyImageHint(block));
      }
      continue;
    }

    textParts.push(renderPromptAttachmentAsText(block));
  }

  const payload: OmpPromptPayload = {
    text: textParts.join("\n\n"),
  };
  if (images.length > 0) {
    payload.images = images;
  }
  return payload;
}

function parseModelReference(modelId: string | null): OmpModelReference | null {
  if (!modelId) {
    return null;
  }
  if (modelId.includes("/")) {
    const [provider, ...rest] = modelId.split("/");
    const id = rest.join("/");
    if (provider && id) {
      return { provider, id };
    }
  }
  if (modelId.includes(":")) {
    const [provider, ...rest] = modelId.split(":");
    const id = rest.join(":");
    if (provider && id) {
      return { provider, id };
    }
  }
  return { id: modelId };
}

function isOmpFastModeEligibleModel(
  model: OmpModel | null | undefined,
  configuredModel: string | null | undefined,
): boolean {
  const provider = model?.provider ?? parseModelReference(configuredModel ?? null)?.provider;
  if (provider === "openai" || provider === "openai-codex") return true;
  if (!model || provider === "fireworks" || provider === "github-copilot") return false;
  const usesOpenAIWireApi =
    model.api === "openai-completions" ||
    model.api === "openai-responses" ||
    model.api === "openai-codex-responses";
  if (!usesOpenAIWireApi) return false;
  return /\bgpt(?:\b|\d)/i.test(`${model.id} ${model.name ?? ""}`);
}

function parsePersistenceMetadata(metadata: AgentMetadata | undefined): OmpPersistenceMetadata {
  if (!metadata) {
    return {};
  }
  return {
    ...(typeof metadata.cwd === "string" ? { cwd: metadata.cwd } : {}),
    ...(typeof metadata.model === "string" ? { model: metadata.model } : {}),
    ...(typeof metadata.thinkingOptionId === "string"
      ? { thinkingOptionId: metadata.thinkingOptionId }
      : {}),
    ...(typeof metadata.modeId === "string" ? { modeId: metadata.modeId } : {}),
    ...(typeof metadata.systemPrompt === "string" ? { systemPrompt: metadata.systemPrompt } : {}),
  };
}

function buildResumeConfig(
  metadata: OmpPersistenceMetadata,
  overrides: Partial<AgentSessionConfig> | undefined,
  provider: AgentProvider,
): OmpResumeConfig {
  const overrideConfig = overrides ?? {};
  const cwd = overrideConfig.cwd ?? metadata.cwd ?? process.cwd();
  const model = overrideConfig.model ?? metadata.model;
  const thinkingOptionId = overrideConfig.thinkingOptionId ?? metadata.thinkingOptionId;
  const modeId = overrideConfig.modeId ?? metadata.modeId;
  return {
    cwd,
    model,
    thinkingOptionId,
    modeId,
    config: {
      ...overrideConfig,
      provider,
      cwd,
      model,
      thinkingOptionId,
      modeId,
      systemPrompt: overrideConfig.systemPrompt ?? metadata.systemPrompt,
    },
  };
}

function buildResumeStartInput(input: {
  resumeConfig: OmpResumeConfig;
  sessionFile: string;
  launchContext: AgentLaunchContext | undefined;
  launchMode: { modeId: string | null; extraArgs?: string[] };
}): OmpStartSessionInput {
  return {
    cwd: input.resumeConfig.cwd,
    protocolMode: "rpc-ui",
    env: input.launchContext?.env,
    session: input.sessionFile,
    model: input.resumeConfig.model,
    thinkingOptionId: normalizeOmpThinkingOption(input.resumeConfig.thinkingOptionId) ?? undefined,
    ...(input.launchMode.modeId ? { modeId: input.launchMode.modeId } : {}),
    ...(input.launchMode.extraArgs ? { extraArgs: input.launchMode.extraArgs } : {}),
    systemPrompt: composeSystemPromptParts(
      input.resumeConfig.config.systemPrompt,
      input.resumeConfig.config.daemonAppendSystemPrompt,
    ),
  };
}

function readNativeMessageId(
  message: OmpAgentMessage & { id?: unknown; entryId?: unknown },
): string | undefined {
  if (typeof message.id === "string") {
    return message.id;
  }
  return typeof message.entryId === "string" ? message.entryId : undefined;
}

function withOmpCapabilities(): AgentCapabilityFlags {
  return {
    ...OMP_CORE_CAPABILITIES,
    supportsMcpServers: false,
    supportsNativePaseoTools: true,
  };
}

function isOmpRequestAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  return /\brequest was aborted\b|\babort(ed)?\b/i.test(toDiagnosticErrorMessage(error));
}

function resolveThinkingOptionId(
  cachedThinkingOptionId: string | null,
  sessionThinkingLevel: OmpThinkingLevel | undefined,
): OmpThinkingLevel | null {
  const currentThinking = cachedThinkingOptionId ?? sessionThinkingLevel;
  return normalizeOmpThinkingOption(currentThinking);
}

function modelToId(model: OmpModel | null | undefined): string | null {
  return model?.provider && model.id ? `${model.provider}/${model.id}` : null;
}

function ompAssistantText(message: Extract<OmpAgentMessage, { role: "assistant" }>): string | null {
  const text = message.content
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.text];
      }
      if (part.type === "thinking") {
        return [part.thinking];
      }
      return [];
    })
    .join("\n\n")
    .trim();
  return text.length > 0 ? text : null;
}
interface OmpPlanDraft {
  text: string;
  messageId?: string;
}

function latestOmpPlan(
  messages: readonly OmpAgentMessage[],
  streamedPlan: OmpPlanDraft | null,
): OmpPlanDraft | null {
  const latestAssistant = messages.findLast((message) => message.role === "assistant");
  const terminalText = latestAssistant?.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
  const text = terminalText || streamedPlan?.text.trim();
  if (!text) {
    return null;
  }
  const messageId = latestAssistant?.responseId || streamedPlan?.messageId;
  return {
    text,
    ...(messageId ? { messageId } : {}),
  };
}

function formatOmpErrorMessage(message: Extract<OmpAgentMessage, { role: "assistant" }>): string {
  const headline = message.errorMessage?.trim() || "OMP turn failed";
  const details = [
    message.stopReason ? `stopReason=${message.stopReason}` : null,
    message.provider && message.model ? `model=${message.provider}/${message.model}` : null,
    message.responseModel ? `responseModel=${message.responseModel}` : null,
    message.responseId ? `responseId=${message.responseId}` : null,
  ].filter((detail): detail is string => detail !== null);
  const partialText = ompAssistantText(message);
  if (partialText) {
    details.push(`partial=${JSON.stringify(partialText.slice(0, 500))}`);
  }
  return details.length > 0 ? `${headline} (${details.join(", ")})` : headline;
}

function latestOmpErrorMessage(messages: OmpAgentMessage[]): string | null {
  const latestAssistant = messages.findLast((message) => message.role === "assistant");
  if (!latestAssistant || !latestAssistant.errorMessage?.trim()) {
    return null;
  }
  return formatOmpErrorMessage(latestAssistant);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOmpYamlDocument(configYaml: string) {
  const document = parseDocument(configYaml);
  if (document.errors.length > 0) {
    throw new Error(`Invalid OMP models.yml: ${document.errors[0]}`);
  }
  return document;
}

function parseOmpModelsDocument(configYaml: string) {
  const document = parseOmpYamlDocument(configYaml);
  const root = document.toJS() as unknown;
  if (root !== null && !isRecord(root)) {
    throw new Error("OMP models.yml root must be an object");
  }
  const providers = isRecord(root) ? root.providers : undefined;
  if (providers !== undefined && !isRecord(providers)) {
    throw new Error("OMP models.yml providers must be an object");
  }
  return { document, providers: isRecord(providers) ? providers : null };
}

export function formatOmpModelsYaml(configYaml: string): string {
  return parseOmpYamlDocument(configYaml).toString({
    collectionStyle: "block",
    indent: 2,
    lineWidth: 0,
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readActiveAskUserDialog(toolName: string, args: unknown): ActiveAskUserDialog | null {
  if (toolName !== "ask_user" || !isRecord(args)) {
    return null;
  }
  return {
    allowComment: optionalBoolean(args.allowComment) ?? false,
    allowFreeform: optionalBoolean(args.allowFreeform) ?? true,
    allowMultiple: optionalBoolean(args.allowMultiple) ?? false,
  };
}

function isOptionalInputPlaceholder(placeholder: string | undefined): boolean {
  return /\boptional\b|\bskip\b/i.test(placeholder ?? "");
}

function getInputQuestionTitle(title: string | undefined, placeholder: string | undefined): string {
  if (!isOptionalInputPlaceholder(placeholder)) {
    return title ?? "Enter a value";
  }
  if (/\bcomment\b/i.test(`${title ?? ""}\n${placeholder ?? ""}`)) {
    return "Optional comment";
  }
  return "Optional response";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isOmpAskUserFreeformOption(option: string): boolean {
  return option === OMP_ASK_USER_FREEFORM_SENTINEL;
}

function mapExtensionUiRequestToPermission(
  event: Extract<OmpRuntimeEvent, { type: "extension_ui_request" }>,
  options: ExtensionUiMappingOptions = {},
): AgentPermissionRequest | null {
  const provider = options.provider ?? OMP_PROVIDER;
  const label = options.label ?? "OMP";
  switch (event.method) {
    case "select": {
      const selectOptions = readStringArray(event.options);
      if (options.combineOptionalComment) {
        return buildCombinedAskUserQuestionPermission(event, {
          provider,
          label,
          question: optionalString(event.title) ?? "Select an option",
          options: selectOptions,
          allowFreeform: options.allowFreeform === true,
        });
      }
      return buildExtensionUiQuestionPermission(event, {
        provider,
        label,
        question: optionalString(event.title) ?? "Select an option",
        options: selectOptions,
        multiSelect: false,
      });
    }
    case "input": {
      const placeholder = optionalString(event.placeholder);
      const title = optionalString(event.title);
      const allowEmpty = isOptionalInputPlaceholder(placeholder);
      return buildExtensionUiQuestionPermission(event, {
        provider,
        label,
        question: getInputQuestionTitle(title, placeholder),
        options: [],
        multiSelect: false,
        ...(placeholder ? { placeholder } : {}),
        ...(allowEmpty ? { allowEmpty: true, dismissLabel: "Skip" } : {}),
      });
    }
    case "editor":
      return buildExtensionUiQuestionPermission(event, {
        provider,
        label,
        question: optionalString(event.title) ?? "Edit text",
        options: [],
        multiSelect: false,
      });
    case "confirm":
      return buildExtensionUiQuestionPermission(event, {
        provider,
        label,
        question: [optionalString(event.title), optionalString(event.message)]
          .filter(Boolean)
          .join("\n\n"),
        options: ["Yes", "No"],
        multiSelect: false,
      });
    default:
      return null;
  }
}

function isExtensionUiRequestEvent(
  event: OmpRuntimeEvent,
): event is Extract<OmpRuntimeEvent, { type: "extension_ui_request" }> {
  return event.type === "extension_ui_request" && typeof event.id === "string";
}

function isProcessExitEvent(
  event: OmpRuntimeEvent,
): event is Extract<OmpRuntimeEvent, { type: "process_exit" }> {
  return event.type === "process_exit" && typeof event.error === "string";
}

function isOmpAgentSessionEvent(event: OmpRuntimeEvent): event is OmpAgentSessionEvent {
  switch (event.type) {
    case "agent_start":
    case "turn_start":
    case "message_start":
    case "message_end":
    case "message_update":
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
    case "compaction_start":
    case "compaction_end":
    case "agent_end":
      return true;
    default:
      return false;
  }
}

function buildExtensionUiQuestionPermission(
  event: Extract<OmpRuntimeEvent, { type: "extension_ui_request" }>,
  input: {
    provider: AgentProvider;
    label: string;
    question: string;
    options: string[];
    multiSelect: boolean;
    placeholder?: string;
    allowEmpty?: boolean;
    dismissLabel?: string;
  },
): AgentPermissionRequest {
  return {
    id: event.id,
    provider: input.provider,
    name: `${input.label} ${event.method}`,
    kind: "question",
    title: input.question,
    input: {
      questions: [
        {
          question: input.question,
          header: QUESTION_RESPONSE_HEADER,
          options: input.options.map((label) => ({ label })),
          multiSelect: input.multiSelect,
          ...(input.placeholder ? { placeholder: input.placeholder } : {}),
          ...(input.allowEmpty ? { allowEmpty: true } : {}),
          ...(input.dismissLabel ? { dismissLabel: input.dismissLabel } : {}),
        },
      ],
    },
    metadata: {
      extensionUiMethod: event.method,
      answerHeader: QUESTION_RESPONSE_HEADER,
    },
  };
}

function buildCombinedAskUserQuestionPermission(
  event: Extract<OmpRuntimeEvent, { type: "extension_ui_request" }>,
  input: {
    provider: AgentProvider;
    label: string;
    question: string;
    options: string[];
    allowFreeform: boolean;
  },
): AgentPermissionRequest {
  const visibleOptions = input.options.filter((option) => !isOmpAskUserFreeformOption(option));
  const allowOther = input.allowFreeform || visibleOptions.length !== input.options.length;
  return {
    id: event.id,
    provider: input.provider,
    name: `${input.label} ask_user`,
    kind: "question",
    title: input.question,
    input: {
      questions: [
        {
          question: input.question,
          header: QUESTION_RESPONSE_HEADER,
          options: visibleOptions.map((label) => ({ label })),
          multiSelect: false,
          ...(allowOther ? { allowOther: true } : {}),
        },
        {
          question: "Optional comment",
          header: QUESTION_COMMENT_HEADER,
          options: [],
          multiSelect: false,
          placeholder: "Optional comment (press Enter to skip)...",
          allowEmpty: true,
        },
      ],
    },
    metadata: {
      extensionUiMethod: event.method,
      answerHeader: QUESTION_RESPONSE_HEADER,
      commentHeader: QUESTION_COMMENT_HEADER,
      combinedAskUser: COMBINED_ASK_USER_METADATA,
      selectOptions: visibleOptions,
      ...(allowOther ? { freeformSentinel: OMP_ASK_USER_FREEFORM_SENTINEL } : {}),
    },
  };
}

function permissionAnswer(input: AgentMetadata | undefined, header: string): string | null {
  const answers = isRecord(input?.answers) ? input.answers : null;
  if (!answers) {
    return null;
  }
  const answer = answers[header];
  return typeof answer === "string" ? answer : null;
}

function firstPermissionAnswer(input: AgentMetadata | undefined): string | null {
  const answers = isRecord(input?.answers) ? input.answers : null;
  if (!answers) {
    return null;
  }
  const first = Object.values(answers).find((value) => typeof value === "string");
  return typeof first === "string" ? first : null;
}

function isCombinedAskUserPermission(request: AgentPermissionRequest): boolean {
  return request.metadata?.combinedAskUser === COMBINED_ASK_USER_METADATA;
}

function buildCombinedAskUserSelectionResponse(
  request: AgentPermissionRequest,
  response: AgentPermissionResponse,
): {
  uiResponse: { value?: string; cancelled?: boolean };
  pendingResponse: PendingCombinedAskUserResponse | null;
} {
  if (response.behavior === "deny") {
    return { uiResponse: { cancelled: true }, pendingResponse: null };
  }

  const answer = permissionAnswer(response.updatedInput, QUESTION_RESPONSE_HEADER);
  if (answer === null) {
    return { uiResponse: { cancelled: true }, pendingResponse: null };
  }

  const selectOptions = readStringArray(request.metadata?.selectOptions);
  const freeformSentinel = optionalString(request.metadata?.freeformSentinel);
  const isFreeform = Boolean(freeformSentinel) && !selectOptions.includes(answer);
  const comment = permissionAnswer(response.updatedInput, QUESTION_COMMENT_HEADER) ?? "";
  return {
    uiResponse: { value: isFreeform ? freeformSentinel : answer },
    pendingResponse: {
      comment,
      freeform: isFreeform ? answer : null,
    },
  };
}

function buildExtensionUiResponse(
  request: AgentPermissionRequest,
  response: AgentPermissionResponse,
): { value?: string; confirmed?: boolean; cancelled?: boolean } {
  if (response.behavior === "deny") {
    return { cancelled: true };
  }

  const method = optionalString(request.metadata?.extensionUiMethod);
  const answer = firstPermissionAnswer(response.updatedInput);
  if (answer === null) {
    return { cancelled: true };
  }

  if (method === "confirm") {
    return { confirmed: /^yes$/i.test(answer.trim()) };
  }
  return { value: answer };
}

function createRuntime(
  logger: Logger,
  runtimeSettings: ProviderRuntimeSettings | undefined,
): OmpRuntime {
  return new OmpCliRuntime({
    logger,
    runtimeSettings,
    command: ["omp"],
    commandsRpcName: "get_available_commands",
  });
}

export class OmpAgentSession implements AgentSession {
  readonly provider: AgentProvider = OMP_PROVIDER;
  readonly capabilities: AgentCapabilityFlags = withOmpCapabilities();
  readonly features: AgentFeature[];

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly activeToolCalls = new Map<string, OmpTrackedToolCall>();
  private readonly pendingExtensionUiRequests = new Map<string, AgentPermissionRequest>();
  private activeAskUserDialog: ActiveAskUserDialog | null = null;
  private pendingCombinedAskUserResponse: PendingCombinedAskUserResponse | null = null;
  private activeTurnId: string | null = null;
  private activeClientMessageId: string | null = null;
  private activeAssistantMessageId: string | null = null;
  private activeTurnTerminalAssistantMessage: OmpAgentMessage | null = null;
  private activePlanText = "";
  private activePlanMessageId: string | null = null;
  private activeTurnStarted = false;
  private activeTurnHasUserMessage = false;
  private activeNoTurnPromptText: string | null = null;
  private readonly pendingNoTurnOutputs: Array<{ turnId: string; message: string }> = [];
  private activePromptRequestId: string | null = null;
  private activePromptAgentInvoked: boolean | null = null;
  private readonly pendingPromptResults = new Map<string, boolean>();
  private pendingNoTurnCompletionAbort: AbortController | null = null;
  private lastKnownThinkingOptionId: string | null;
  private outOfBandCompactionEmit: ((event: AgentStreamEvent) => void) | null = null;
  private outOfBandCompactionStarted = false;
  private outOfBandCompactionCompleted = false;
  private commandCache: AgentSlashCommand[] | null = null;
  private readonly subagentIndex = new OmpSubagentIndex();
  private readonly subagentCardTracker: OmpSubagentCardTracker;
  private lastTodoItem: Extract<AgentTimelineItem, { type: "todo" }> | null = null;
  private state: OmpSessionState;
  private currentModeId: string | null;
  private activeWorkflowMode: OmpWorkflowMode | null;
  private workflowModePending: OmpWorkflowSelection | null;
  private readonly providerIdleScheduler: OmpProviderIdleScheduler;
  private readonly noTurnScheduler: OmpNoTurnScheduler;
  private readonly usagePoller: OmpUsagePoller;
  private closed = false;
  private live: boolean;
  private readonly emittedUserMessageIds = new Set<string>();
  private lastEmittedLiveUserMessageText: string | null = null;
  private lastSubmittedPromptText: string | null = null;
  private lastSubmittedPromptClientMessageId: string | null = null;

  constructor(options: OmpAgentSessionOptions) {
    this.runtimeSession = options.runtimeSession;
    this.config = options.config;
    this.oauthAccounts = [...(options.oauthAccounts ?? [])];
    this.state = options.initialState;
    const configuredModeId = options.currentModeId ?? null;
    const configuredWorkflowMode = normalizeOmpWorkflowSelection(
      options.config.featureValues?.[OMP_WORKFLOW_FEATURE_ID],
    );
    this.currentModeId = configuredModeId;
    this.fastModeSupported = typeof options.initialState.fastModeEnabled === "boolean";
    const configuredFastMode = optionalBoolean(
      options.config.featureValues?.[OMP_FAST_MODE_FEATURE_ID],
    );
    this.fastModeEnabled = options.initialState.fastModeEnabled === true;
    this.features = createOmpFeatures(options.config, this.oauthAccounts, {
      supported: this.fastModeSupported,
      eligible: isOmpFastModeEligibleModel(options.initialState.model, options.config.model),
      enabled: configuredFastMode ?? this.fastModeEnabled,
    });
    this.activeWorkflowMode =
      options.live === false && configuredWorkflowMode !== "standard"
        ? configuredWorkflowMode
        : null;
    this.workflowModePending =
      (options.live ?? true) && configuredWorkflowMode !== "standard"
        ? configuredWorkflowMode
        : null;
    this.logger = options.logger;
    this.paseoTools = options.paseoTools;
    this.live = options.live ?? true;
    this.providerIdleScheduler = options.providerIdleScheduler ?? createOmpProviderIdleScheduler();
    this.noTurnScheduler = options.noTurnScheduler ?? createOmpNoTurnScheduler();
    this.usagePoller = new OmpUsagePoller({
      scheduler: options.usagePollScheduler,
      readStats: () => this.runtimeSession.getSessionStats(),
      onUsage: (usage, turnId) => {
        this.emit({
          type: "usage_updated",
          provider: this.provider,
          usage,
          ...(turnId === undefined ? {} : { turnId }),
        });
      },
      onPollError: (error) => {
        this.logger.debug({ err: error }, "OMP context usage poll failed");
      },
    });
    this.subagentCardTracker = new OmpSubagentCardTracker({
      scheduler: options.subagentCardScheduler,
    });
    this.lastKnownThinkingOptionId =
      normalizeOmpThinkingOption(options.config.thinkingOptionId) ??
      this.state.thinkingLevel ??
      null;
    this.runtimeSession.onEvent((event) => {
      this.handleRuntimeEvent(event);
    });
    void this.runtimeSession.setSubagentSubscription("events").catch((eventsError: unknown) => {
      this.logger.debug(
        { err: eventsError },
        "OMP subagent event subscription unavailable; falling back to progress",
      );
      void this.runtimeSession
        .setSubagentSubscription("progress")
        .catch((progressError: unknown) => {
          this.logger.debug(
            { err: progressError },
            "OMP subagent progress subscription unavailable",
          );
        });
    });
  }

  private readonly runtimeSession: OmpRuntimeSession;
  private readonly config: AgentSessionConfig;
  private readonly logger: Logger;
  private readonly paseoTools?: PaseoToolCatalog;
  private readonly oauthAccounts: readonly StoredOmpOAuthAccount[];
  private readonly fastModeSupported: boolean;
  private fastModeEnabled: boolean;

  private refreshFeatures(): void {
    const nextFeatures = createOmpFeatures(this.config, this.oauthAccounts, {
      eligible: isOmpFastModeEligibleModel(this.state.model, this.config.model),
      supported: this.fastModeSupported,
      enabled: this.fastModeEnabled,
    });
    this.features.splice(0, this.features.length, ...nextFeatures);
  }

  get id(): string | null {
    return this.state.sessionId;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, o) => this.startTurn(p, o),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.state.sessionId,
      reduceFinalText: ({ current, item }) =>
        item.type === "assistant_message" ? `${current}${item.text}` : current,
    });
  }

  async startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<StartTurnResult> {
    if (this.activeTurnId) {
      throw new Error("An OMP turn is already active");
    }
    this.dismissPendingPlanApproval();

    const payload = convertPromptInput(prompt, { model: this.state.model });
    const workflowMode = this.workflowModePending;
    if (workflowMode === "standard") {
      await this.disableActiveWorkflowMode();
      this.workflowModePending = null;
    } else if (workflowMode) {
      if (this.activeWorkflowMode && this.activeWorkflowMode !== workflowMode) {
        await this.disableActiveWorkflowMode();
      }
      payload.text = `/${workflowMode} ${payload.text}`;
      this.activeWorkflowMode = workflowMode;
      this.workflowModePending = null;
    }
    const turnId = randomUUID();
    this.live = true;
    this.activeTurnId = turnId;
    this.activeClientMessageId = options?.clientMessageId ?? null;
    this.lastSubmittedPromptText = payload.text;
    this.lastSubmittedPromptClientMessageId = this.activeClientMessageId;
    this.activeAssistantMessageId = null;
    this.activeTurnTerminalAssistantMessage = null;
    this.activePlanText = "";
    this.activePlanMessageId = null;
    this.activeTurnStarted = false;
    this.activeTurnHasUserMessage = false;
    this.activePromptRequestId = null;
    this.clearNoTurnBuffers();
    this.activeNoTurnPromptText = payload.text;
    this.usagePoller.startTurn();

    void (async () => {
      try {
        const ack = await this.runtimeSession.prompt(payload.text, payload.images);
        this.activePromptRequestId = ack.requestId ?? null;
        const correlatedResult = ack.requestId
          ? this.pendingPromptResults.get(ack.requestId)
          : undefined;
        if (ack.requestId) {
          this.pendingPromptResults.delete(ack.requestId);
        }
        this.activePromptAgentInvoked = correlatedResult ?? ack.agentInvoked ?? null;
        if (correlatedResult === false) {
          this.scheduleNoTurnPromptCompletion(turnId);
          return;
        }
        if (correlatedResult !== true && ack.agentInvoked === false) {
          await this.completeNoTurnPrompt(turnId);
          return;
        }
      } catch (error) {
        if (this.activeTurnId !== turnId) {
          return;
        }
        this.usagePoller.stopTurn();
        this.activeTurnId = null;
        this.activeClientMessageId = null;
        this.activeTurnStarted = false;
        this.activeTurnHasUserMessage = false;
        this.activeAssistantMessageId = null;
        this.activeTurnTerminalAssistantMessage = null;
        this.clearNoTurnBuffers();
        if (isOmpRequestAbortError(error)) {
          this.emit({
            type: "turn_canceled",
            provider: this.provider,
            turnId,
            reason: toDiagnosticErrorMessage(error),
          });
          return;
        }
        this.emit({
          type: "turn_failed",
          provider: this.provider,
          turnId,
          error: toDiagnosticErrorMessage(error),
        });
      }
    })();

    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    yield* streamOmpHistory({
      sessionFile: this.state.sessionFile,
      runtimeSession: this.runtimeSession,
      provider: this.provider,
    });
    for (const item of mapOmpTodoState(this.state)) {
      yield {
        type: "timeline",
        provider: this.provider,
        item,
      };
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    await this.refreshState();
    return {
      provider: this.provider,
      sessionId: this.state.sessionId,
      model: modelToId(this.state.model),
      thinkingOptionId: resolveThinkingOptionId(
        this.lastKnownThinkingOptionId,
        this.state.thinkingLevel,
      ),
      modeId: this.currentModeId,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [...OMP_MODES];
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentModeId;
  }

  async setMode(modeId: string): Promise<void | AgentProviderNotice> {
    if (!OMP_MODES.some((mode) => mode.id === modeId)) {
      throw new Error(`Invalid OMP approval mode '${modeId}'`);
    }
    if (this.currentModeId === modeId) {
      return;
    }
    return {
      type: "warning",
      message: "Start a new OMP session to change approval mode",
    };
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    if (featureId === OMP_FAST_MODE_FEATURE_ID) {
      if (typeof value !== "boolean") {
        throw new Error(`Invalid OMP fast mode '${String(value)}'`);
      }
      const feature = this.features.find((candidate) => candidate.id === featureId);
      if (feature?.type !== "toggle") {
        throw new Error("OMP fast mode is unavailable for the current model");
      }
      const result = await this.runtimeSession.setFastMode(value);
      this.fastModeEnabled = result.enabled;
      this.state = {
        ...this.state,
        fastModeEnabled: result.enabled,
        fastModeActive: result.active,
      };
      feature.value = result.enabled;
      this.config.featureValues = {
        ...this.config.featureValues,
        [OMP_FAST_MODE_FEATURE_ID]: result.enabled,
      };
      return;
    }
    if (featureId === OMP_OAUTH_ACCOUNT_FEATURE_ID) {
      if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new Error(`Invalid OMP OAuth account '${String(value)}'`);
      }
      const credentialId = Number(value);
      if (!Number.isSafeInteger(credentialId) || credentialId <= 0) {
        throw new Error(`Invalid OMP OAuth account '${value}'`);
      }
      const feature = this.features.find((candidate) => candidate.id === featureId);
      if (feature?.type !== "select") {
        throw new Error("OMP OAuth account feature is unavailable");
      }
      const modelProvider =
        this.state.model?.provider ?? parseModelReference(this.config.model ?? null)?.provider;
      const account = this.oauthAccounts.find(
        (candidate) =>
          candidate.credentialId === credentialId && candidate.provider === modelProvider,
      );
      if (!account) {
        throw new Error(`OMP OAuth account '${value}' is unavailable for the current model`);
      }
      await this.pinOAuthAccount(account);
      feature.value = value;
      this.config.featureValues = {
        ...this.config.featureValues,
        [OMP_OAUTH_ACCOUNT_FEATURE_ID]: value,
      };
      return;
    }
    if (featureId !== OMP_WORKFLOW_FEATURE_ID) {
      throw new Error(`Unsupported OMP feature '${featureId}'`);
    }
    if (value !== "standard" && value !== "plan" && value !== "goal") {
      throw new Error(`Invalid OMP workflow '${String(value)}'`);
    }
    const feature = this.features[0];
    if (feature?.type !== "select") {
      throw new Error("OMP workflow feature is unavailable");
    }
    feature.value = value;
    this.config.featureValues = {
      ...this.config.featureValues,
      [OMP_WORKFLOW_FEATURE_ID]: value,
    };
    this.workflowModePending = value === this.activeWorkflowMode ? null : value;
    if (value !== "plan") {
      this.dismissPendingPlanApproval();
    }
  }

  private async applyConfiguredFastMode(): Promise<void> {
    if (!this.fastModeSupported) return;
    if (!isOmpFastModeEligibleModel(this.state.model, this.config.model)) return;
    const configured = optionalBoolean(this.config.featureValues?.[OMP_FAST_MODE_FEATURE_ID]);
    if (configured === undefined) {
      this.fastModeEnabled = this.state.fastModeEnabled === true;
      this.refreshFeatures();
      return;
    }
    if (configured === this.fastModeEnabled) {
      this.refreshFeatures();
      return;
    }
    const result = await this.runtimeSession.setFastMode(configured);
    this.fastModeEnabled = result.enabled;
    this.state = {
      ...this.state,
      fastModeEnabled: result.enabled,
      fastModeActive: result.active,
    };
    this.refreshFeatures();
  }

  private async pinOAuthAccount(account: StoredOmpOAuthAccount): Promise<void> {
    let position = -1;
    let providerPosition = 0;
    for (const candidate of this.oauthAccounts) {
      if (candidate.provider !== account.provider) continue;
      if (candidate.credentialId === account.credentialId) {
        position = providerPosition;
        break;
      }
      providerPosition += 1;
    }
    if (position < 0) {
      throw new Error(`OMP OAuth account '${account.credentialId}' is unavailable`);
    }
    if (this.activeTurnId) {
      throw new Error("Cannot pin an OMP OAuth account while a turn is active");
    }
    const ack = await this.runtimeSession.prompt(`/session pin ${position + 1}`);
    if (ack.requestId) {
      this.pendingPromptResults.delete(ack.requestId);
    }
  }

  private async pinConfiguredOAuthAccount(): Promise<void> {
    const configuredCredentialId = optionalString(
      this.config.featureValues?.[OMP_OAUTH_ACCOUNT_FEATURE_ID],
    );
    if (!configuredCredentialId) return;
    if (!this.features.some((feature) => feature.id === OMP_OAUTH_ACCOUNT_FEATURE_ID)) return;
    const modelProvider =
      this.state.model?.provider ?? parseModelReference(this.config.model ?? null)?.provider;
    const account = this.oauthAccounts.find(
      (candidate) =>
        String(candidate.credentialId) === configuredCredentialId &&
        candidate.provider === modelProvider,
    );
    if (!account) return;
    await this.pinOAuthAccount(account);
  }

  async initialize(): Promise<void> {
    await this.applyConfiguredFastMode();
    await this.pinConfiguredOAuthAccount();
  }

  async setGoalObjective(objective: string): Promise<void> {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) {
      throw new Error("OMP goal objective is required");
    }
    const workflowFeature = this.features[0];
    if (workflowFeature?.type !== "select" || workflowFeature.value !== "goal") {
      throw new Error("OMP goal mode is not active");
    }
    this.config.featureValues = {
      ...this.config.featureValues,
      goal_objective: normalizedObjective,
    };
  }

  async controlGoal(action: "start" | "pause" | "delete"): Promise<void> {
    const objective = optionalString(this.config.featureValues?.goal_objective)?.trim();
    if (action === "start" && !objective) {
      throw new Error("OMP goal objective is required before starting");
    }
    if (action === "delete" && !objective && this.activeWorkflowMode === null) {
      this.clearGoalConfiguration();
      return;
    }
    const command =
      action === "start" ? `/goal ${objective}` : action === "pause" ? "/goal pause" : "/goal drop";
    if (this.activeTurnId) {
      this.runtimeSession.followUp(command);
    } else {
      await this.runtimeSession.prompt(command);
    }
    if (action === "delete") {
      this.clearGoalConfiguration();
    }
  }

  private clearGoalConfiguration(): void {
    this.workflowModePending = null;
    this.config.featureValues = {
      ...this.config.featureValues,
      goal_objective: undefined,
    };
    this.setActiveWorkflowMode(null);
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.pendingExtensionUiRequests.values()];
  }

  async respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const request = this.pendingExtensionUiRequests.get(requestId);
    if (!request) {
      throw new Error(`No pending permission request with id '${requestId}'`);
    }

    if (request.name === OMP_PLAN_APPROVAL_REQUEST_NAME) {
      if (response.behavior === "allow") {
        await this.disableActiveWorkflowMode();
      }
      this.pendingExtensionUiRequests.delete(requestId);
      this.emitPermissionResolution(requestId, response);
      return response.behavior === "allow"
        ? {
            followUpPrompt:
              "The plan is approved. Exit planning and implement it now. Use tools and modify the working tree as required.",
          }
        : undefined;
    }

    this.pendingExtensionUiRequests.delete(requestId);
    if (isCombinedAskUserPermission(request)) {
      const combined = buildCombinedAskUserSelectionResponse(request, response);
      this.pendingCombinedAskUserResponse = combined.pendingResponse;
      this.runtimeSession.respondToExtensionUiRequest(requestId, combined.uiResponse);
    } else {
      this.runtimeSession.respondToExtensionUiRequest(
        requestId,
        buildOmpRpcUiPermissionResponse(request, response) ??
          buildExtensionUiResponse(request, response),
      );
    }
    this.emitPermissionResolution(requestId, response);
  }

  private emitPermissionResolution(requestId: string, resolution: AgentPermissionResponse): void {
    this.emit({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution,
      turnId: this.currentTurnIdForEvent(),
    });
  }

  private dismissPendingPlanApproval(): void {
    if (!this.pendingExtensionUiRequests.delete(OMP_PLAN_APPROVAL_REQUEST_ID)) {
      return;
    }
    this.emitPermissionResolution(OMP_PLAN_APPROVAL_REQUEST_ID, {
      behavior: "deny",
      selectedActionId: "continue-planning",
      message: "Superseded by a new planning request",
    });
  }

  private emitPlanApprovalRequest(
    turnId: string | undefined,
    messages: readonly OmpAgentMessage[],
    streamedPlan: OmpPlanDraft | null,
  ): void {
    if (this.activeWorkflowMode !== "plan") {
      return;
    }
    const plan = latestOmpPlan(messages, streamedPlan);
    if (!plan) {
      return;
    }
    const request: AgentPermissionRequest = {
      id: OMP_PLAN_APPROVAL_REQUEST_ID,
      provider: this.provider,
      name: OMP_PLAN_APPROVAL_REQUEST_NAME,
      kind: "plan",
      input: { plan: plan.text },
      actions: [
        {
          id: "continue-planning",
          label: "Continue planning",
          behavior: "deny",
          variant: "secondary",
          intent: "dismiss",
        },
        {
          id: "implement",
          label: "Approve and implement",
          behavior: "allow",
          variant: "primary",
          intent: "implement",
        },
      ],
      metadata: plan.messageId ? { planMessageId: plan.messageId } : {},
    };
    this.pendingExtensionUiRequests.set(request.id, request);
    this.emit({
      type: "permission_requested",
      provider: this.provider,
      request,
      turnId,
    });
  }

  describePersistence(): AgentPersistenceHandle | null {
    return {
      provider: this.provider,
      sessionId: this.state.sessionId,
      nativeHandle: this.state.sessionFile,
      metadata: {
        cwd: this.config.cwd,
        ...(this.config.model ? { model: this.config.model } : {}),
        ...(this.config.thinkingOptionId ? { thinkingOptionId: this.config.thinkingOptionId } : {}),
        ...(this.currentModeId ? { modeId: this.currentModeId } : {}),
      },
    };
  }

  async interrupt(): Promise<void> {
    const turnId = this.activeTurnId;
    await this.runtimeSession.abort();
    if (turnId && this.activeTurnId === turnId) {
      this.terminalizeActiveWork();
      this.usagePoller.stopTurn();
      this.activeTurnId = null;
      this.activeClientMessageId = null;
      this.activeTurnStarted = false;
      this.activeTurnHasUserMessage = false;
      this.activeAssistantMessageId = null;
      this.activeTurnTerminalAssistantMessage = null;
      this.clearNoTurnBuffers();
      this.emit({
        type: "turn_canceled",
        provider: this.provider,
        reason: "interrupted",
        turnId,
      });
    }
  }

  async revertConversation(input: { messageId: string }): Promise<void> {
    if (this.activeTurnId) {
      throw new Error("Cannot rewind the OMP conversation while a turn is active");
    }
    const target = input.messageId.trim();
    if (!target) {
      throw new Error("OMP rewind requires a user message id");
    }
    await this.runtimeSession.branch(target);
    await this.refreshState();
    this.activeToolCalls.clear();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.usagePoller.close();
    this.cancelNoTurnPromptCompletion();
    try {
      await this.runtimeSession.close();
    } finally {
      this.clearOmpSessionState();
    }
  }

  private clearOmpSessionState(): void {
    this.subagentIndex.clear(this.runtimeSession);
    this.clearOmpTurnState();
  }

  private clearOmpTurnState(): void {
    clearOmpHostToolState(this.runtimeSession);
    this.subagentCardTracker.clear();
  }

  private terminalizeActiveWork(): void {
    for (const [toolCallId, toolCall] of this.activeToolCalls) {
      this.emitToolCallEvent(toolCallId, toolCall, "canceled", null, null);
    }
    this.activeToolCalls.clear();
    for (const event of this.subagentIndex.terminalizeRunning(this.runtimeSession)) {
      this.emit(event);
    }
    this.clearOmpTurnState();
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    if (this.commandCache) {
      return this.commandCache;
    }
    const commands = await this.runtimeSession.getCommands();
    return mapOmpRuntimeSlashCommands(commands);
  }

  tryHandleOutOfBand(
    prompt: AgentPromptInput,
  ): { run(ctx: { emit: (event: AgentStreamEvent) => void }): Promise<void> } | null {
    if (typeof prompt !== "string") {
      return null;
    }
    const parsed = this.parseSlashCommandInput(prompt);
    if (!parsed) {
      return null;
    }
    this.live = true;
    const commandName = parsed.commandName.toLowerCase();
    if (commandName === "compact") {
      return {
        run: async ({ emit }) => {
          await this.executeCompactCommand(parsed.args, emit);
        },
      };
    }
    if (commandName === "autocompact") {
      return {
        run: async ({ emit }) => {
          await this.executeAutoCompactCommand(parsed.args, emit);
        },
      };
    }
    if (commandName === "steer" || commandName === "follow-up") {
      const message = parsed.args?.trim();
      if (!message) {
        return null;
      }
      return {
        run: async () => {
          if (commandName === "steer") {
            this.runtimeSession.steer(message);
          } else {
            this.runtimeSession.followUp(message);
          }
        },
      };
    }
    if (commandName === "handoff") {
      return {
        run: async ({ emit }) => {
          await this.executeHandoffCommand(parsed.args, emit);
        },
      };
    }
    return null;
  }

  async setModel(modelId: string | null): Promise<void> {
    const parsedReference = parseModelReference(modelId);
    if (!parsedReference) {
      return;
    }
    if (!parsedReference.provider) {
      throw new Error(`OMP model id must include a provider: ${modelId}`);
    }

    const model = await this.runtimeSession.setModel(parsedReference.provider, parsedReference.id);
    this.state = {
      ...this.state,
      model,
    };
    this.config.model = `${model.provider}/${model.id}`;
    this.refreshFeatures();
    await this.applyConfiguredFastMode();
    await this.pinConfiguredOAuthAccount();
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    const thinkingLevel =
      normalizeOmpThinkingOption(thinkingOptionId) ?? DEFAULT_OMP_THINKING_LEVEL;
    await this.runtimeSession.setThinkingLevel(thinkingLevel);
    this.lastKnownThinkingOptionId = thinkingLevel;
    this.config.thinkingOptionId = thinkingLevel;
    this.state = {
      ...this.state,
      thinkingLevel,
    };
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private currentTurnIdForEvent(): string | undefined {
    return this.activeTurnId ?? undefined;
  }

  private scheduleNoTurnPromptCompletion(turnId: string): void {
    this.cancelNoTurnPromptCompletion();
    const abort = new AbortController();
    this.pendingNoTurnCompletionAbort = abort;
    void this.noTurnScheduler
      .waitForSettle(abort.signal)
      .then(async () => {
        if (this.pendingNoTurnCompletionAbort !== abort) {
          return undefined;
        }
        this.pendingNoTurnCompletionAbort = null;
        return await this.completeNoTurnPrompt(turnId);
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          this.logger.debug({ err: error }, "OMP local-only settle wait failed");
        }
      });
  }

  private cancelNoTurnPromptCompletion(): void {
    this.pendingNoTurnCompletionAbort?.abort();
    this.pendingNoTurnCompletionAbort = null;
  }

  private async completeNoTurnPrompt(turnId: string): Promise<void> {
    await waitForImmediate();
    if (
      this.closed ||
      this.activeTurnId !== turnId ||
      this.activeTurnStarted ||
      this.activePromptAgentInvoked === true ||
      this.activeTurnHasUserMessage
    ) {
      return;
    }
    this.emitBufferedNoTurnOutputs(turnId);
    this.completeTurn(turnId, []);
  }

  private clearNoTurnBuffers(): void {
    this.cancelNoTurnPromptCompletion();
    this.activeNoTurnPromptText = null;
    this.activePromptRequestId = null;
    this.activePromptAgentInvoked = null;
    this.pendingNoTurnOutputs.splice(0, this.pendingNoTurnOutputs.length);
  }

  private emitBufferedNoTurnOutputs(turnId: string): void {
    const promptText = this.activeNoTurnPromptText;
    const outputs = this.pendingNoTurnOutputs.filter((output) => output.turnId === turnId);
    this.clearNoTurnBuffers();
    if (promptText) {
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "user_message",
          text: promptText,
          ...(this.activeClientMessageId ? { clientMessageId: this.activeClientMessageId } : {}),
        },
      });
    }
    for (const output of outputs) {
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "assistant_message",
          text: output.message,
        },
      });
    }
  }

  private bufferNoTurnOutput(message: string): void {
    if (!this.activeTurnId || this.activeTurnStarted) {
      return;
    }
    this.pendingNoTurnOutputs.push({ turnId: this.activeTurnId, message });
  }

  private parseSlashCommandInput(text: string): OmpSlashCommandInvocation | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/") || trimmed.length <= 1) {
      return null;
    }
    const withoutPrefix = trimmed.slice(1);
    const firstWhitespaceIdx = withoutPrefix.search(/\s/);
    const commandName =
      firstWhitespaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, firstWhitespaceIdx);
    if (!commandName || commandName.includes("/")) {
      return null;
    }
    const rawArgs =
      firstWhitespaceIdx === -1 ? "" : withoutPrefix.slice(firstWhitespaceIdx + 1).trim();
    return rawArgs.length > 0 ? { commandName, args: rawArgs } : { commandName };
  }

  private async executeCompactCommand(
    customInstructions: string | undefined,
    emit: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    if (this.outOfBandCompactionEmit) {
      throw new Error("An OMP compact command is already running");
    }
    this.outOfBandCompactionEmit = emit;
    this.outOfBandCompactionStarted = false;
    this.outOfBandCompactionCompleted = false;
    try {
      await this.runtimeSession.compact(customInstructions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        this.outOfBandCompactionEmit === emit &&
        this.outOfBandCompactionStarted &&
        !this.outOfBandCompactionCompleted
      ) {
        this.emitCompactionTimeline({
          turnId: undefined,
          item: {
            type: "compaction",
            status: "completed",
            trigger: "manual",
          },
        });
      }
      emit({
        type: "timeline",
        provider: this.provider,
        item: {
          type: "assistant_message",
          text: `[Error] Failed to compact context: ${message}`,
        },
      });
    } finally {
      if (this.outOfBandCompactionEmit === emit && !this.outOfBandCompactionStarted) {
        this.outOfBandCompactionEmit = null;
        this.outOfBandCompactionStarted = false;
        this.outOfBandCompactionCompleted = false;
      }
    }
  }

  private async executeAutoCompactCommand(
    mode: string | undefined,
    emit: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    let enabled = parseAutoCompactMode(mode);
    if (enabled === "unknown") {
      emit({
        type: "timeline",
        provider: this.provider,
        item: {
          type: "assistant_message",
          text: "[Error] Usage: /autocompact [on|off|toggle]",
        },
      });
      return;
    }
    if (enabled === "toggle") {
      const state = await this.runtimeSession.getState();
      if (typeof state.autoCompactionEnabled !== "boolean") {
        emit({
          type: "timeline",
          provider: this.provider,
          item: {
            type: "assistant_message",
            text: "[Error] Auto-compaction state is unavailable. Use /autocompact on or /autocompact off.",
          },
        });
        return;
      }
      enabled = !state.autoCompactionEnabled;
    }

    try {
      await this.runtimeSession.setAutoCompaction(enabled);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        type: "timeline",
        provider: this.provider,
        item: {
          type: "assistant_message",
          text: `[Error] Failed to set auto-compaction: ${message}`,
        },
      });
      return;
    }
    this.state = {
      ...this.state,
      autoCompactionEnabled: enabled,
    };
    emit({
      type: "timeline",
      provider: this.provider,
      item: {
        type: "assistant_message",
        text: `Auto-compaction ${enabled ? "enabled" : "disabled"}.`,
      },
    });
  }

  private async executeHandoffCommand(
    instructions: string | undefined,
    emit: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    try {
      await this.runtimeSession.handoff(instructions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        type: "timeline",
        provider: this.provider,
        item: {
          type: "assistant_message",
          text: `[Error] Failed to hand off turn: ${message}`,
        },
      });
    }
  }

  private handleExtensionUiRequest(
    event: Extract<OmpRuntimeEvent, { type: "extension_ui_request" }>,
  ): void {
    const message = optionalString(event.message);
    if (event.method === "notify" && message) {
      this.bufferNoTurnOutput(message);
    }

    const sideEffectItem = this.mapExtensionUiSideEffect(event);
    if (sideEffectItem) {
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: this.currentTurnIdForEvent(),
        item: sideEffectItem,
      });
      return;
    }

    if (this.respondToCombinedAskUserFollowUp(event)) {
      return;
    }

    const shouldCombineOptionalComment =
      event.method === "select" &&
      this.activeAskUserDialog?.allowComment === true &&
      this.activeAskUserDialog.allowMultiple === false;
    const request =
      mapOmpRpcUiPermissionRequest(event, { provider: this.provider }) ??
      mapExtensionUiRequestToPermission(event, {
        provider: this.provider,
        label: "OMP",
        combineOptionalComment: shouldCombineOptionalComment,
        allowFreeform: this.activeAskUserDialog?.allowFreeform,
      });
    if (!request) {
      return;
    }

    this.pendingExtensionUiRequests.set(request.id, request);
    this.emit({
      type: "permission_requested",
      provider: this.provider,
      request,
      turnId: this.currentTurnIdForEvent(),
    });
  }

  private mapExtensionUiSideEffect(
    event: Extract<OmpRuntimeEvent, { type: "extension_ui_request" }>,
  ): AgentTimelineItem | null {
    if (event.method !== "open_url" || typeof event.url !== "string") {
      return null;
    }
    const lines = [`[Open URL](${event.url})`, `URL: ${event.url}`];
    if (typeof event.launchUrl === "string") {
      lines.push(`Launch URL: ${event.launchUrl}`);
    }
    if (typeof event.instructions === "string") {
      lines.push("", event.instructions);
    }
    return { type: "assistant_message", text: lines.join("\n") };
  }

  private respondToCombinedAskUserFollowUp(
    event: Extract<OmpRuntimeEvent, { type: "extension_ui_request" }>,
  ): boolean {
    const pending = this.pendingCombinedAskUserResponse;
    if (!pending || event.method !== "input") {
      return false;
    }

    const placeholder = optionalString(event.placeholder);
    if (pending.freeform !== null && !isOptionalInputPlaceholder(placeholder)) {
      this.pendingCombinedAskUserResponse = {
        ...pending,
        freeform: null,
      };
      this.runtimeSession.respondToExtensionUiRequest(event.id, { value: pending.freeform });
      return true;
    }

    if (isOptionalInputPlaceholder(placeholder)) {
      this.pendingCombinedAskUserResponse = null;
      this.runtimeSession.respondToExtensionUiRequest(event.id, { value: pending.comment });
      return true;
    }

    return false;
  }

  private handleCommandOutput(textValue: unknown): void {
    const text = stripAnsi(optionalString(textValue) ?? "").trim();
    if (!text) {
      return;
    }
    if (/Plan mode (?:disabled|paused)/i.test(text)) {
      this.setActiveWorkflowMode(null);
    } else if (/Plan mode enabled/i.test(text)) {
      this.setActiveWorkflowMode("plan");
    }
    if (!this.activeTurnId) {
      return;
    }
    if (!this.activeTurnStarted) {
      this.bufferNoTurnOutput(text);
      return;
    }
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId: this.currentTurnIdForEvent(),
      item: { type: "assistant_message", text },
    });
  }
  private updateWorkflowModeFromRuntimeEvent(event: OmpRuntimeEvent): void {
    if (event.type !== "goal_updated") return;
    const goalStatus = event.state?.goal?.status ?? event.goal?.status;
    const goalActive =
      event.state?.enabled === true && goalStatus !== "complete" && goalStatus !== "dropped";
    this.setActiveWorkflowMode(goalActive ? "goal" : null);
  }

  private setActiveWorkflowMode(mode: OmpWorkflowMode | null): void {
    this.activeWorkflowMode = mode;
    const feature = this.features[0];
    if (feature?.type === "select") {
      feature.value = mode ?? "standard";
    }
    this.config.featureValues = {
      ...this.config.featureValues,
      [OMP_WORKFLOW_FEATURE_ID]: mode ?? "standard",
    };
  }

  private async disableActiveWorkflowMode(): Promise<void> {
    if (!this.activeWorkflowMode) return;
    if (this.activeWorkflowMode === "goal") {
      await this.runtimeSession.prompt("/goal drop");
    }
    this.setActiveWorkflowMode(null);
  }

  private handleExtraRuntimeEvent(event: OmpRuntimeEvent): boolean {
    this.updateWorkflowModeFromRuntimeEvent(event);
    if (
      handleOmpHostToolRuntimeEvent(event, {
        runtimeSession: this.runtimeSession,
        paseoTools: this.paseoTools,
        logger: this.logger,
      })
    ) {
      return true;
    }
    if (event.type === "subagent_lifecycle") {
      const payload = (event as Extract<OmpRuntimeEvent, { type: "subagent_lifecycle" }>).payload;
      if (payload.parentToolCallId && this.activeToolCalls.has(payload.parentToolCallId)) {
        this.subagentCardTracker.handleLifecycle(payload, (toolCallId) =>
          this.emitActiveToolCall(toolCallId),
        );
      }
      for (const mapped of this.subagentIndex.handleLifecycle(this.runtimeSession, payload)) {
        this.emit(mapped);
      }
      return true;
    }
    if (event.type === "subagent_progress") {
      const payload = (event as Extract<OmpRuntimeEvent, { type: "subagent_progress" }>).payload;
      if (payload.parentToolCallId && this.activeToolCalls.has(payload.parentToolCallId)) {
        this.subagentCardTracker.handleProgress(payload, (toolCallId) =>
          this.emitActiveToolCall(toolCallId),
        );
      }
      for (const mapped of this.subagentIndex.handleProgress(this.runtimeSession, payload)) {
        this.emit(mapped);
      }
      return true;
    }
    if (event.type === "subagent_event") {
      const payload = (event as Extract<OmpRuntimeEvent, { type: "subagent_event" }>).payload;
      for (const mapped of this.subagentIndex.handleEvent(this.runtimeSession, payload)) {
        this.emit(mapped);
      }
      return true;
    }
    if (event.type === "todo_reminder") {
      const item = mapOmpTodoReminderEvent(event);
      if (item) {
        this.emitTodoItem(item);
      } else {
        this.logger.debug({ event }, "Dropped malformed OMP todo reminder event");
      }
      return true;
    }
    if (event.type === "available_commands_update") {
      const commands = mapOmpAvailableCommandsUpdate(event);
      if (commands) {
        this.commandCache = commands;
      } else {
        this.logger.debug({ event }, "Dropped malformed OMP command update event");
      }
      return true;
    }
    const mappedEvent = mapOmpRuntimeEventToTimelineItem(event);
    if (!mappedEvent.handled) {
      return false;
    }
    if (mappedEvent.item) {
      this.emit({
        type: "timeline",
        provider: this.provider,
        item: mappedEvent.item,
      });
    } else {
      this.logger.debug(
        { event, reason: mappedEvent.logReason },
        "Dropped unsupported OMP runtime event",
      );
    }
    return true;
  }

  private emitActiveToolCall(toolCallId: string): boolean {
    const toolCall = this.activeToolCalls.get(toolCallId);
    return toolCall ? this.emitToolCallEvent(toolCallId, toolCall, "running", null, null) : false;
  }

  private emitTodoItem(item: AgentTimelineItem, turnId?: string): void {
    if (item.type === "todo") {
      const previous = this.lastTodoItem;
      const isDuplicate =
        previous?.items.length === item.items.length &&
        previous.items.every((previousItem, index) => {
          const nextItem = item.items[index];
          return (
            nextItem?.text === previousItem.text && nextItem.completed === previousItem.completed
          );
        });
      if (isDuplicate) {
        return;
      }
      this.lastTodoItem = item;
    }
    this.emit({ type: "timeline", provider: this.provider, turnId, item });
  }

  private handleRuntimeEvent(event: OmpRuntimeEvent): void {
    if (isExtensionUiRequestEvent(event)) {
      this.handleExtensionUiRequest(event);
      return;
    }
    if (isProcessExitEvent(event)) {
      this.handleProcessExit(event.error);
      return;
    }
    if (event.type === "command_output") {
      this.handleCommandOutput(event.text);
      return;
    }
    if (event.type === "prompt_result") {
      const requestId = optionalString("id" in event ? event.id : undefined);
      const agentInvoked =
        "agentInvoked" in event && typeof event.agentInvoked === "boolean"
          ? event.agentInvoked
          : undefined;
      if (requestId && agentInvoked !== undefined) {
        if (requestId === this.activePromptRequestId && this.activeTurnId) {
          this.activePromptAgentInvoked = agentInvoked;
          if (agentInvoked === false) {
            this.scheduleNoTurnPromptCompletion(this.activeTurnId);
          } else {
            this.cancelNoTurnPromptCompletion();
          }
        } else if (this.activePromptRequestId === null) {
          this.pendingPromptResults.set(requestId, agentInvoked);
        }
      }
      return;
    }
    if (this.handleExtraRuntimeEvent(event)) {
      return;
    }
    if (isOmpAgentSessionEvent(event)) {
      if (event.type === "agent_start") {
        this.live = true;
      } else if (!this.live) {
        // A resumed OMP process replays session events for pre-existing
        // conversation on startup; that content is delivered via
        // streamHistory, so replay must not re-enter the live timeline.
        return;
      }
      this.handleSessionEvent(event);
      return;
    }
    this.logger.debug({ event }, "Dropped unknown OMP runtime event");
  }

  private handleProcessExit(error: string): void {
    this.usagePoller.stopTurn();
    this.terminalizeActiveWork();
    this.subagentIndex.clear(this.runtimeSession);
    if (!this.activeTurnId) {
      return;
    }
    const turnId = this.activeTurnId;
    this.activeTurnId = null;
    this.activeClientMessageId = null;
    this.activeTurnStarted = false;
    this.activeTurnHasUserMessage = false;
    this.activeTurnTerminalAssistantMessage = null;
    this.clearNoTurnBuffers();
    this.emit({
      type: "turn_failed",
      provider: this.provider,
      turnId,
      error,
    });
  }

  private handleSessionEvent(event: OmpAgentSessionEvent): void {
    const turnId = this.currentTurnIdForEvent();

    switch (event.type) {
      case "agent_start":
        this.activeTurnStarted = true;
        this.clearNoTurnBuffers();
        this.emit({
          type: "thread_started",
          provider: this.provider,
          sessionId: this.state.sessionId,
        });
        return;
      case "turn_start":
        this.activeTurnStarted = true;
        this.clearNoTurnBuffers();
        this.emit({
          type: "turn_started",
          provider: this.provider,
          turnId,
        });
        return;
      case "message_start":
        this.handleMessageStart(event);
        return;
      case "message_end":
        if (event.message.role === "user") {
          this.activeTurnHasUserMessage = true;
        }
        this.handleMessageEnd(event, turnId);
        return;
      case "message_update":
        this.handleMessageUpdate(event, turnId);
        return;
      case "tool_execution_start": {
        const toolCall = parseToolArgs(event.toolName, event.args);
        this.activeToolCalls.set(event.toolCallId, toolCall);
        this.activeAskUserDialog = readActiveAskUserDialog(event.toolName, event.args);
        this.emitToolCallEvent(event.toolCallId, toolCall, "running", null, null);
        return;
      }
      case "tool_execution_update": {
        const toolCall = this.activeToolCalls.get(event.toolCallId);
        if (!toolCall) {
          return;
        }

        const partialResult = parseToolResult(event.partialResult);
        this.emitToolCallEvent(event.toolCallId, toolCall, "running", partialResult, null);
        return;
      }
      case "tool_execution_end": {
        this.handleToolExecutionEnd(event, turnId);
        return;
      }
      case "compaction_start":
        this.emitCompactionTimeline({
          turnId,
          item: {
            type: "compaction",
            status: "loading",
            trigger: event.reason === "manual" ? "manual" : "auto",
          },
        });
        return;
      case "compaction_end":
        this.emitCompactionTimeline({
          turnId,
          item: {
            type: "compaction",
            status: "completed",
            trigger: event.reason === "manual" ? "manual" : "auto",
          },
        });
        return;
      case "agent_end": {
        const messages = event.messages ?? [];
        let terminalMessages: OmpAgentMessage[] | null = null;
        if (messages.some((message) => message.role === "assistant")) {
          terminalMessages = messages;
        } else if (this.activeTurnTerminalAssistantMessage) {
          terminalMessages = [this.activeTurnTerminalAssistantMessage];
        }
        // OMP can end an internal extension-notice cycle before it starts the
        // model turn for the same prompt. Ignore only cycles where neither the
        // terminal payload nor the live stream contained an assistant message.
        if (!terminalMessages) {
          return;
        }
        // A state request is processed after OMP's RPC loop becomes promptable,
        // so do not advertise Paseo idle until it reports that transition.
        void this.completeTurnAfterProviderIdle(turnId, terminalMessages);
        return;
      }
      default:
        return;
    }
  }

  private handleToolExecutionEnd(
    event: Extract<OmpAgentSessionEvent, { type: "tool_execution_end" }>,
    turnId: string | undefined,
  ): void {
    const toolCall =
      this.activeToolCalls.get(event.toolCallId) ?? parseToolArgs(event.toolName, null);
    this.activeToolCalls.delete(event.toolCallId);

    if (event.toolName === "ask_user") {
      this.activeAskUserDialog = null;
      this.pendingCombinedAskUserResponse = null;
    }

    const result = parseToolResult(event.result);
    const error = event.isError ? event.result : null;
    const status = event.isError ? "failed" : "completed";
    this.emitToolCallEvent(event.toolCallId, toolCall, status, result, error);
    if (event.toolName === "task") {
      this.subagentCardTracker.delete(event.toolCallId);
    }
    if (event.toolName === "todo") {
      const item = mapOmpTodoToolResult(result);
      if (item) {
        this.emitTodoItem(item, turnId);
      } else {
        this.logger.debug({ event }, "Dropped malformed OMP todo tool result");
      }
    }
  }

  private emitCompactionTimeline(input: {
    turnId: string | undefined;
    item: Extract<AgentStreamEvent, { type: "timeline" }>["item"];
  }): void {
    const emitOutOfBand = this.outOfBandCompactionEmit;
    if (emitOutOfBand && input.item.type === "compaction") {
      if (input.item.status === "loading") {
        this.outOfBandCompactionStarted = true;
      }
      if (input.item.status === "completed") {
        this.outOfBandCompactionCompleted = true;
      }
    }
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: this.provider,
      ...(emitOutOfBand ? {} : { turnId: input.turnId }),
      item: input.item,
    };
    if (emitOutOfBand) {
      emitOutOfBand(event);
      if (input.item.type === "compaction" && input.item.status === "completed") {
        this.outOfBandCompactionEmit = null;
        this.outOfBandCompactionStarted = false;
        this.outOfBandCompactionCompleted = false;
      }
      return;
    }
    this.emit(event);
  }

  private handleMessageUpdate(
    event: Extract<OmpAgentSessionEvent, { type: "message_update" }>,
    turnId: string | undefined,
  ): void {
    if (event.message.role !== "assistant") {
      return;
    }
    if (event.assistantMessageEvent.type === "text_delta") {
      // Omp-compatible runtimes may emit updates without a preceding message_start.
      this.activeAssistantMessageId ??= event.message.responseId || randomUUID();
      const delta = event.assistantMessageEvent.delta ?? "";
      if (this.activeWorkflowMode === "plan") {
        this.activePlanText += delta;
        this.activePlanMessageId ??= this.activeAssistantMessageId;
      }
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "assistant_message",
          text: delta,
          messageId: this.activeAssistantMessageId,
          ...(this.activeWorkflowMode === "plan" ? { presentation: "plan" as const } : {}),
        },
      });
      return;
    }
    if (event.assistantMessageEvent.type === "thinking_delta") {
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "reasoning",
          text: event.assistantMessageEvent.delta ?? "",
        },
      });
    }
  }

  private handleMessageStart(
    event: Extract<OmpAgentSessionEvent, { type: "message_start" }>,
  ): void {
    if (event.message.role === "assistant") {
      this.activeAssistantMessageId = event.message.responseId || null;
      if (this.activeWorkflowMode === "plan" && event.message.responseId) {
        this.activePlanMessageId = event.message.responseId;
      }
    }
  }

  private handleMessageEnd(
    event: Extract<OmpAgentSessionEvent, { type: "message_end" }>,
    turnId: string | undefined,
  ): void {
    if (event.message.role === "assistant") {
      this.activeAssistantMessageId = null;
      if (turnId) {
        this.activeTurnTerminalAssistantMessage = event.message;
      }
      return;
    }
    if (event.message.role === "custom") {
      if (shouldDisplayOmpCustomMessage(event.message)) {
        const text = getUserMessageText(event.message.content);
        if (text) {
          const item =
            mapOmpAdvisorMessageToToolCall(event.message, text) ??
            mapOmpSystemNoticeToToolCall(text);
          this.emit({
            type: "timeline",
            provider: this.provider,
            turnId,
            item: item ?? { type: "assistant_message", text },
          });
        }
      }
      if (!this.activeTurnHasUserMessage) {
        this.completeTurn(turnId, []);
      }
      return;
    }

    if (event.message.role !== "user") {
      return;
    }
    const text = getUserMessageText(event.message.content);
    if (!text) {
      return;
    }
    // Image prompts can produce a second, late user message_end frame after the
    // turn has completed. Its native entry id may differ, so id-only
    // deduplication cannot recognize it. Suppress a replay of the last live text
    // when no turn is active, or when it arrives during a newer prompt.
    if (
      text === this.lastEmittedLiveUserMessageText &&
      (!turnId || text !== this.lastSubmittedPromptText)
    ) {
      return;
    }
    const nativeMessage = event.message as OmpAgentMessage & { id?: unknown; entryId?: unknown };
    const messageId = readNativeMessageId(nativeMessage);
    const clientMessageId =
      text === this.lastSubmittedPromptText
        ? (this.activeClientMessageId ?? this.lastSubmittedPromptClientMessageId)
        : null;
    const emitUserMessage = (resolvedMessageId?: string): void => {
      if (resolvedMessageId) {
        // OMP re-emits user message_end frames for entries it has already
        // surfaced (e.g. after steer or a resumed process); emit each native
        // entry exactly once.
        if (this.emittedUserMessageIds.has(resolvedMessageId)) {
          return;
        }
        this.emittedUserMessageIds.add(resolvedMessageId);
      }
      this.lastEmittedLiveUserMessageText = text;
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "user_message",
          text,
          ...(resolvedMessageId ? { messageId: resolvedMessageId } : {}),
          ...(clientMessageId ? { clientMessageId } : {}),
        },
      });
    };
    if (messageId) {
      emitUserMessage(messageId);
      return;
    }
    void this.runtimeSession
      .getBranchMessages()
      .then((messages) =>
        emitUserMessage(messages.toReversed().find((message) => message.text === text)?.entryId),
      )
      .catch((error: unknown) => {
        this.logger.debug(
          { err: error, sessionFile: this.state.sessionFile },
          "OMP native user message ID lookup failed",
        );
        emitUserMessage();
      });
  }

  private emitToolCallEvent(
    toolCallId: string,
    toolCall: OmpTrackedToolCall,
    status: "running" | "completed" | "failed" | "canceled",
    result: OmpToolResult,
    error: unknown,
  ): boolean {
    const turnId = this.currentTurnIdForEvent();
    const detail = this.mapToolDetail(toolCallId, toolCall, result);
    if (!detail) {
      return false;
    }
    const baseItem = {
      type: "tool_call" as const,
      callId: toolCallId,
      name: resolveToolCallName(toolCall, result),
      detail,
    };
    const item =
      status === "failed" ? { ...baseItem, status, error } : { ...baseItem, status, error: null };
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId,
      item,
    });
    return true;
  }

  private mapToolDetail(
    toolCallId: string,
    toolCall: OmpTrackedToolCall,
    result: OmpToolResult,
  ): ToolCallDetail | null {
    return mapOmpToolDetail(toolCall, result, {
      toolCallId,
      mapSubagentDetail: (detail) =>
        this.subagentCardTracker.detailFor(toolCallId, detail) ?? detail,
    });
  }

  private completeTurn(turnId: string | undefined, messages: OmpAgentMessage[]): void {
    const streamedPlanText = this.activePlanText.trim();
    const streamedPlan: OmpPlanDraft | null = streamedPlanText
      ? {
          text: streamedPlanText,
          ...(this.activePlanMessageId ? { messageId: this.activePlanMessageId } : {}),
        }
      : null;
    this.activeTurnId = null;
    this.activeClientMessageId = null;
    this.activeAssistantMessageId = null;
    this.activeTurnTerminalAssistantMessage = null;
    this.activePlanText = "";
    this.activePlanMessageId = null;
    this.activeTurnStarted = false;
    this.activeTurnHasUserMessage = false;
    this.clearNoTurnBuffers();
    const errorMessage = latestOmpErrorMessage(messages);
    if (typeof errorMessage === "string" && errorMessage.length > 0) {
      this.usagePoller.stopTurn();
      this.emit({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: errorMessage,
      });
      return;
    }
    this.emitPlanApprovalRequest(turnId, messages, streamedPlan);
    const finalUsage = this.usagePoller.completeTurn(turnId);
    this.emit({
      type: "turn_completed",
      provider: this.provider,
      turnId,
    });
    void this.refreshAfterTurn(finalUsage);
  }

  private async completeTurnAfterProviderIdle(
    turnId: string | undefined,
    messages: OmpAgentMessage[],
  ): Promise<void> {
    while (!this.closed && this.activeTurnStarted && this.currentTurnIdForEvent() === turnId) {
      try {
        const state = await this.runtimeSession.getState();
        this.state = state;
        if (!state.isStreaming && !state.isCompacting) {
          this.completeTurn(turnId, messages);
          return;
        }
      } catch (error) {
        this.logger.debug({ err: error }, "OMP state unavailable while waiting for provider idle");
      }
      await this.providerIdleScheduler.waitForRetry();
    }
  }

  private async refreshState(): Promise<void> {
    this.state = await this.runtimeSession.getState();
    if (
      this.fastModeSupported &&
      typeof this.state.fastModeEnabled === "boolean" &&
      this.fastModeEnabled !== this.state.fastModeEnabled
    ) {
      this.fastModeEnabled = this.state.fastModeEnabled;
      this.refreshFeatures();
    }
  }

  private async refreshAfterTurn(finalUsage: Promise<void>): Promise<void> {
    await Promise.all([this.refreshState().catch(() => undefined), finalUsage]);
  }
}

export class OmpAgentClient implements AgentClient {
  readonly provider: AgentProvider = OMP_PROVIDER;
  readonly capabilities: AgentCapabilityFlags = withOmpCapabilities();

  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly providerParams: OmpRuntimeProviderParams;
  private readonly modelRoleParams: OmpModelRoleParams;
  private readonly subagentCardScheduler?: OmpSubagentCardScheduler;
  private readonly providerIdleScheduler?: OmpProviderIdleScheduler;
  private readonly noTurnScheduler?: OmpNoTurnScheduler;
  private readonly usagePollScheduler?: OmpUsagePollScheduler;
  private readonly quotaFetch: typeof fetch;
  private readonly quotaNow: () => number;
  private readonly runtime: OmpRuntime;
  private readonly oauthAccountsOverride?: readonly StoredOmpOAuthAccount[];
  private readonly loginFlows = new Map<string, OmpProviderLoginFlow>();

  constructor(options: OmpAgentClientOptions) {
    ensureManagedOmpOnPath();
    const { runtimeProviderParams, modelRoleParams } = resolveOmpProviderParams(
      options.providerParams,
    );
    const runtimeSettings = mergeOmpRuntimeSettings(
      {
        command: {
          mode: "replace",
          argv: ["omp"],
        },
      },
      options.runtimeSettings,
    );
    this.logger = options.logger;
    this.runtimeSettings = runtimeSettings;
    this.providerParams = runtimeProviderParams;
    this.modelRoleParams = modelRoleParams;
    this.subagentCardScheduler = options.subagentCardScheduler;
    this.providerIdleScheduler = options.providerIdleScheduler;
    this.noTurnScheduler = options.noTurnScheduler;
    this.usagePollScheduler = options.usagePollScheduler;
    this.quotaFetch = options.quotaFetch ?? fetch;
    this.quotaNow = options.quotaNow ?? Date.now;
    this.runtime = options.runtime ?? createRuntime(options.logger, runtimeSettings);
    this.oauthAccountsOverride = options.oauthAccounts;
  }

  private async configureNativePaseoTools(
    runtimeSession: OmpRuntimeSession,
    catalog: PaseoToolCatalog | undefined,
  ): Promise<void> {
    if (!catalog) {
      return;
    }
    await setOmpHostTools(runtimeSession, catalog);
  }
  private readOAuthAccounts(launchEnv?: Record<string, string>): StoredOmpOAuthAccount[] {
    if (this.oauthAccountsOverride !== undefined) {
      return [...this.oauthAccountsOverride];
    }
    try {
      const env = { ...process.env, ...this.runtimeSettings?.env, ...launchEnv };
      const { agentDb } = resolveOmpDiagnosticPaths(env);
      return readStoredOmpOAuthAccounts(agentDb);
    } catch (error) {
      this.logger.debug({ err: error }, "OMP OAuth account lookup failed");
      return [];
    }
  }

  private async createInitializedSession(
    runtimeSession: OmpRuntimeSession,
    config: AgentSessionConfig,
    options: Omit<OmpAgentSessionOptions, "runtimeSession" | "config" | "oauthAccounts">,
    oauthAccounts: readonly StoredOmpOAuthAccount[],
  ): Promise<OmpAgentSession> {
    const session = new OmpAgentSession({
      runtimeSession,
      config,
      oauthAccounts,
      ...options,
    });
    await session.initialize();
    return session;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const launchMode = this.resolveLaunchMode(config.modeId);
    const runtimeSession = await this.runtime.startSession({
      cwd: config.cwd,
      protocolMode: "rpc-ui",
      model: config.model,
      thinkingOptionId: normalizeOmpThinkingOption(config.thinkingOptionId) ?? undefined,
      noSession: config.internal === true,
      modeId: launchMode.modeId,
      extraArgs: launchMode.extraArgs,
      systemPrompt: composeSystemPromptParts(config.systemPrompt, config.daemonAppendSystemPrompt),
      env: launchContext?.env,
    });
    try {
      await this.configureNativePaseoTools(runtimeSession, launchContext?.paseoTools);
      return await this.createInitializedSession(
        runtimeSession,
        config,
        {
          initialState: await runtimeSession.getState(),
          currentModeId: launchMode.modeId,
          logger: this.logger,
          subagentCardScheduler: this.subagentCardScheduler,
          providerIdleScheduler: this.providerIdleScheduler,
          noTurnScheduler: this.noTurnScheduler,
          usagePollScheduler: this.usagePollScheduler,
          paseoTools: launchContext?.paseoTools,
        },
        this.readOAuthAccounts(launchContext?.env),
      );
    } catch (error) {
      await runtimeSession.close().catch(() => undefined);
      throw error;
    }
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const sessionFile = handle.nativeHandle;
    if (!sessionFile) {
      throw new Error("OMP resume requires a native session file handle");
    }

    const persistenceMetadata = parsePersistenceMetadata(handle.metadata);
    const resumeConfig = buildResumeConfig(persistenceMetadata, overrides, this.provider);

    const launchMode = this.resolveLaunchMode(resumeConfig.modeId);
    const runtimeSession = await this.runtime.startSession(
      buildResumeStartInput({
        resumeConfig,
        sessionFile,
        launchContext,
        launchMode,
      }),
    );
    try {
      await this.configureNativePaseoTools(runtimeSession, launchContext?.paseoTools);
      return await this.createInitializedSession(
        runtimeSession,
        resumeConfig.config,
        {
          initialState: await runtimeSession.getState(),
          currentModeId: launchMode.modeId,
          logger: this.logger,
          subagentCardScheduler: this.subagentCardScheduler,
          providerIdleScheduler: this.providerIdleScheduler,
          noTurnScheduler: this.noTurnScheduler,
          usagePollScheduler: this.usagePollScheduler,
          paseoTools: launchContext?.paseoTools,
          live: false,
        },
        this.readOAuthAccounts(launchContext?.env),
      );
    } catch (error) {
      await runtimeSession.close().catch(() => undefined);
      throw error;
    }
  }

  async fetchCatalog(
    options: FetchCatalogOptions,
    context?: ProviderRefreshContext,
  ): Promise<ProviderCatalog> {
    const launchMode = this.resolveLaunchMode(undefined);
    let runtimeSession: OmpRuntimeSession | undefined;
    let closePromise: Promise<void> | undefined;
    const closeSession = () => {
      if (!runtimeSession) return Promise.resolve();
      closePromise ??= runtimeSession.close();
      return closePromise;
    };
    const handleAbort = () => void closeSession().catch(() => undefined);
    context?.signal.addEventListener("abort", handleAbort, { once: true });
    try {
      await runProviderRefreshActivity(context, "runtime.start", async () => {
        runtimeSession = await this.runtime.startSession({
          cwd: options.scope === "global" ? homedir() : options.cwd,
          protocolMode: "rpc-ui",
          modeId: launchMode.modeId,
          extraArgs: launchMode.extraArgs,
          signal: context?.signal,
        });
        if (context?.signal.aborted) await closeSession();
      });
      if (!runtimeSession) throw new Error("OMP catalog runtime did not start");
      const catalogSession = runtimeSession;
      const models = transformOmpModels(
        (
          await runProviderRefreshActivity(context, "get_available_models", () =>
            catalogSession.getAvailableModels(null),
          )
        ).map((model) => mapOmpModel(model, this.provider)),
      );
      return { models, modes: [...OMP_MODES] };
    } finally {
      context?.signal.removeEventListener("abort", handleAbort);
      await closeSession();
    }
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    return createOmpFeatures(config, this.readOAuthAccounts());
  }

  async listImportableSessions(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]> {
    return await listOmpImportableSessions({
      ...options,
      sessionDir: this.providerParams.sessionDir,
      runtimeSettings: this.runtimeSettings,
    });
  }

  async importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext) {
    const importConfig = await readOmpImportSessionConfig(input.providerHandleId);
    return importSessionFromPersistence({
      provider: this.provider,
      request: input,
      context,
      resumeSession: this.resumeSession.bind(this),
      config: importConfig,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const launch = await this.resolveOmpLaunch();
      const availability = await checkProviderLaunchAvailable(launch);
      return availability.available;
    } catch {
      return false;
    }
  }
  async getOmpProviderManagement(): Promise<OmpProviderManagement> {
    const configPath = this.resolveModelsConfigPath();
    const configYaml = await fs
      .readFile(configPath, "utf8")
      .catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? "providers: {}\n" : Promise.reject(error),
      );
    const providerModels = new Map<
      string,
      Array<{
        id: string;
        name: string;
        contextWindow?: number;
        contextWindowOverride?: number;
      }>
    >();
    const customProviderIds = new Set<string>();
    const contextWindowOverrides = new Map<string, Map<string, number>>();
    try {
      const configuredProviders = parseOmpModelsDocument(configYaml).providers;
      for (const [providerId, configuredProvider] of Object.entries(configuredProviders ?? {})) {
        providerModels.set(providerId, []);
        if (!isRecord(configuredProvider)) continue;
        if (Array.isArray(configuredProvider.models) && configuredProvider.models.length > 0) {
          customProviderIds.add(providerId);
        }
        if (!isRecord(configuredProvider.modelOverrides)) continue;
        const providerOverrides = new Map<string, number>();
        for (const [modelId, override] of Object.entries(configuredProvider.modelOverrides)) {
          if (
            isRecord(override) &&
            Number.isSafeInteger(override.contextWindow) &&
            Number(override.contextWindow) > 0
          ) {
            providerOverrides.set(modelId, Number(override.contextWindow));
          }
        }
        if (providerOverrides.size > 0) {
          contextWindowOverrides.set(providerId, providerOverrides);
        }
      }
    } catch {
      // OMP reports the invalid config through runtimeError below.
    }
    const storedAccountsByProvider = new Map<string, StoredOmpOAuthAccount[]>();
    const storedAccountCredentialsById = new Map<number, StoredOmpOAuthAccountCredential>();
    try {
      const env = { ...process.env, ...this.runtimeSettings?.env };
      const { agentDb } = resolveOmpDiagnosticPaths(env);
      for (const account of readStoredOmpOAuthAccounts(agentDb)) {
        const accounts = storedAccountsByProvider.get(account.provider) ?? [];
        accounts.push(account);
        storedAccountsByProvider.set(account.provider, accounts);
      }
      for (const account of readStoredOmpOAuthAccountCredentials(agentDb)) {
        storedAccountCredentialsById.set(account.credentialId, account);
      }
    } catch (error) {
      this.logger.debug({ err: error }, "OMP OAuth account lookup failed");
    }
    let loginProviders: OmpProviderManagement["loginProviders"] = [];
    let runtimeError: string | undefined;
    let runtimeSession: OmpRuntimeSession | undefined;
    try {
      const launchMode = this.resolveLaunchMode(undefined);
      runtimeSession = await this.runtime.startSession({
        cwd: homedir(),
        protocolMode: "rpc-ui",
        modeId: launchMode.modeId,
        extraArgs: launchMode.extraArgs,
      });
      const [models, providers] = await Promise.all([
        runtimeSession.getAvailableModels(null),
        runtimeSession.getLoginProviders(),
      ]);
      for (const model of models) {
        const providerModelList = providerModels.get(model.provider) ?? [];
        const contextWindowOverride = contextWindowOverrides.get(model.provider)?.get(model.id);
        providerModelList.push({
          id: model.id,
          name: model.name ?? model.id,
          ...(typeof model.contextWindow === "number" && model.contextWindow > 0
            ? { contextWindow: model.contextWindow }
            : {}),
          ...(contextWindowOverride !== undefined ? { contextWindowOverride } : {}),
        });
        providerModels.set(model.provider, providerModelList);
      }
      const quotaByCredentialId = new Map<number, OmpProviderAccountQuota>();
      await Promise.all(
        [...storedAccountCredentialsById.values()]
          .filter((account) => account.provider === "openai-codex")
          .map(async (account) => {
            const quota = await fetchCodexAccountQuota({
              credential: account,
              fetch: this.quotaFetch,
              now: this.quotaNow,
            });
            quotaByCredentialId.set(account.credentialId, quota);
          }),
      );
      loginProviders = providers.map((provider) => {
        const accounts = storedAccountsByProvider.get(provider.id);
        if (!accounts || accounts.length === 0) return provider;
        return {
          ...provider,
          accounts: accounts.map(({ credentialId, identityKey }) => {
            const quota =
              provider.id === "openai-codex" ? quotaByCredentialId.get(credentialId) : undefined;
            return {
              credentialId,
              ...(identityKey ? { identityKey } : {}),
              ...(quota ? { quota } : {}),
            };
          }),
        };
      });
    } catch (error) {
      runtimeError = toDiagnosticErrorMessage(error);
      this.logger.debug({ err: error }, "OMP provider management lookup failed");
    } finally {
      await runtimeSession?.close().catch(() => undefined);
    }
    return {
      configPath,
      configYaml,
      providerModels: [...providerModels]
        .map(([id, models]) => ({
          id,
          modelCount: models.length,
          source: customProviderIds.has(id) ? ("custom" as const) : ("built-in" as const),
          models: models.sort((left, right) => left.name.localeCompare(right.name)),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      loginProviders,
      ...(runtimeError ? { runtimeError } : {}),
    };
  }

  async saveOmpProviderConfig(configYaml: string): Promise<OmpProviderManagement> {
    const configPath = this.resolveModelsConfigPath();
    const previous = await fs
      .readFile(configPath, "utf8")
      .then((contents) => ({ exists: true, contents }) as const)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return { exists: false, contents: "" } as const;
        throw error;
      });
    await writeFileAtomic(configPath, formatOmpModelsYaml(configYaml));
    const management = await this.getOmpProviderManagement();
    if (!management.runtimeError) {
      return management;
    }
    if (previous.exists) {
      await writeFileAtomic(configPath, previous.contents);
    } else {
      await fs.rm(configPath, { force: true });
    }
    throw new Error(`OMP rejected models configuration: ${management.runtimeError}`);
  }
  async addOmpProvider(input: OmpCustomProviderInput): Promise<OmpProviderManagement> {
    const management = await this.getOmpProviderManagement();
    const { document, providers } = parseOmpModelsDocument(management.configYaml);
    if (providers && Object.hasOwn(providers, input.providerId)) {
      throw new Error(`OMP provider '${input.providerId}' already exists`);
    }
    if (!providers) {
      document.set("providers", {});
    }
    document.setIn(["providers", input.providerId], {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      api: input.api,
      auth: "apiKey",
      models: input.models.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        api: input.api,
        input: model.supportsImages ? ["text", "image"] : ["text"],
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      })),
    });
    return await this.saveOmpProviderConfig(document.toString());
  }
  async removeOmpProvider(providerId: string): Promise<OmpProviderManagement> {
    const management = await this.getOmpProviderManagement();
    const { document, providers } = parseOmpModelsDocument(management.configYaml);
    if (!providers || !Object.hasOwn(providers, providerId)) {
      throw new Error(`OMP custom provider '${providerId}' does not exist`);
    }
    document.deleteIn(["providers", providerId]);
    return await this.saveOmpProviderConfig(document.toString());
  }
  async getOmpInstallationStatus(options?: {
    checkForUpdates?: boolean;
  }): Promise<OmpInstallationStatus> {
    return await getOmpInstallationStatus(options);
  }

  async installOmp(): Promise<OmpInstallationStatus> {
    return await installOmp();
  }

  async startOmpProviderLogin(providerId: string): Promise<OmpProviderLoginStart> {
    const runtimeSession = await this.runtime.startSession({
      cwd: homedir(),
      protocolMode: "rpc-ui",
      noSession: true,
    });
    const flowId = randomUUID();
    let resolveActivity = () => {};
    const waitForActivity = new Promise<void>((resolve) => {
      resolveActivity = resolve;
    });
    let resolveStart!: (value: OmpProviderLoginStart) => void;
    let rejectStart!: (error: Error) => void;
    const waitForStart = new Promise<OmpProviderLoginStart>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    const flow: OmpProviderLoginFlow = {
      providerId,
      runtimeSession,
      unsubscribe: () => {},
      loginPromise: Promise.resolve(),
      completed: false,
      waitForActivity,
      resolveActivity,
      timeout: setTimeout(() => {}, 600_000),
    };
    clearTimeout(flow.timeout);
    flow.unsubscribe = runtimeSession.onEvent((event) => {
      if (event.type !== "extension_ui_request") return;
      if (event.method === "open_url" && event.url) {
        resolveStart({
          flowId,
          providerId,
          url: event.url,
          ...(event.launchUrl ? { launchUrl: event.launchUrl } : {}),
          ...(event.instructions ? { instructions: event.instructions } : {}),
        });
      } else if (event.method === "input") {
        flow.inputRequestId = event.id;
        flow.resolveActivity();
      }
    });
    flow.timeout = setTimeout(() => {
      flow.error = new Error("OMP login timed out");
      rejectStart(flow.error);
      flow.resolveActivity();
      this.deleteLoginFlow(flowId);
    }, 600_000);
    flow.loginPromise = runtimeSession
      .login(providerId)
      .then(() => {
        flow.completed = true;
        if (!flow.inputRequestId) {
          rejectStart(new Error("OMP login completed without an authorization URL"));
        }
        return undefined;
      })
      .catch((error) => {
        flow.error = error instanceof Error ? error : new Error(String(error));
        rejectStart(flow.error);
      })
      .finally(async () => {
        flow.resolveActivity();
        await runtimeSession.close().catch(() => undefined);
      });
    this.loginFlows.set(flowId, flow);
    try {
      return await Promise.race([
        waitForStart,
        delay(30_000).then(() => {
          throw new Error("Timed out waiting for OMP authorization URL");
        }),
      ]);
    } catch (error) {
      this.deleteLoginFlow(flowId);
      throw error;
    }
  }

  async finishOmpProviderLogin(flowId: string, input?: string): Promise<OmpProviderManagement> {
    const flow = this.loginFlows.get(flowId);
    if (!flow) {
      throw new Error("OMP login flow is no longer active");
    }
    if (!flow.completed && !flow.error && !flow.inputRequestId) {
      await flow.waitForActivity;
    }
    if (flow.error) {
      this.deleteLoginFlow(flowId);
      throw flow.error;
    }
    if (flow.inputRequestId) {
      const value = input?.trim();
      if (!value) {
        throw new Error("Paste the OAuth code or redirect URL to complete login");
      }
      flow.runtimeSession.respondToExtensionUiRequest(flow.inputRequestId, { value });
      flow.inputRequestId = undefined;
    }
    await flow.loginPromise;
    if (flow.error) {
      this.deleteLoginFlow(flowId);
      throw flow.error;
    }
    this.deleteLoginFlow(flowId);
    return await this.getOmpProviderManagement();
  }
  async cancelOmpProviderLogin(flowId: string): Promise<boolean> {
    const flow = this.loginFlows.get(flowId);
    if (!flow) return false;
    this.loginFlows.delete(flowId);
    clearTimeout(flow.timeout);
    flow.unsubscribe();
    flow.error = new Error("OMP login cancelled");
    flow.resolveActivity();
    await flow.runtimeSession.close();
    return true;
  }
  async logoutOmpProvider(
    providerId: string,
    credentialId?: number,
  ): Promise<OmpProviderManagement> {
    const env = { ...process.env, ...this.runtimeSettings?.env };
    const { agentDb } = resolveOmpDiagnosticPaths(env);
    const changed =
      credentialId === undefined
        ? disableStoredOmpProviderCredentials(agentDb, providerId)
        : disableStoredOmpCredential(agentDb, providerId, credentialId);
    if (changed === 0) {
      if (credentialId !== undefined) {
        throw new Error(`No active OAuth credential ${credentialId} found for ${providerId}`);
      }
      throw new Error(
        `No stored credentials found for ${providerId}; remove environment or config credentials at their source`,
      );
    }
    return await this.getOmpProviderManagement();
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const launch = await this.resolveOmpLaunch();
      const availability = await checkProviderLaunchAvailable(launch);
      const binaryRows = await buildBinaryDiagnosticRows(launch, availability, {
        versionCommand: {
          command: availability.resolvedPath ?? launch.command,
          args: [...launch.args, "--version"],
          env: this.runtimeSettings?.env,
        },
      });
      const version = binaryRows.find((row) => row.label === "Version")?.value ?? "unknown";
      const env = { ...process.env, ...this.runtimeSettings?.env };
      const paths = resolveOmpDiagnosticPaths(env);
      const bunVersion =
        (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun ?? "unavailable";

      return {
        diagnostic: formatProviderDiagnostic("Oh My Pi (OMP)", [
          ...(await buildCommandResolutionDiagnosticRows(launch, {
            knownBinaryNames: ["omp", launch.command],
            pathValue: env.PATH ?? env.Path,
          })),
          ...binaryRows,
          { label: "Version support", value: formatOmpVersionSupport(version) },
          { label: "Active profile", value: paths.profile },
          { label: "Config root", value: paths.configRoot },
          { label: "Agent directory", value: paths.agentDir },
          {
            label: "Agent database",
            value: `${paths.agentDb} (${existsSync(paths.agentDb) ? "found" : "not found"})`,
          },
          { label: "XDG data root", value: paths.xdgDataRoot },
          { label: "XDG state root", value: paths.xdgStateRoot },
          { label: "XDG cache root", value: paths.xdgCacheRoot },
          {
            label: "Bun runtime",
            value: `${bunVersion}; npm-installed OMP requires Bun >= 1.3.14`,
          },
        ]),
      };
    } catch (error) {
      this.logger.debug({ err: error }, "OMP diagnostic lookup failed");
      return {
        diagnostic: formatProviderDiagnosticError("Oh My Pi (OMP)", error),
      };
    }
  }

  async shutdown(): Promise<void> {
    const flows = [...this.loginFlows.values()];
    this.loginFlows.clear();
    for (const flow of flows) {
      clearTimeout(flow.timeout);
      flow.unsubscribe();
    }
    await Promise.all(flows.map((flow) => flow.runtimeSession.close().catch(() => undefined)));
  }

  private deleteLoginFlow(flowId: string): void {
    const flow = this.loginFlows.get(flowId);
    if (!flow) return;
    this.loginFlows.delete(flowId);
    clearTimeout(flow.timeout);
    flow.unsubscribe();
    void flow.runtimeSession.close().catch(() => undefined);
  }

  private resolveModelsConfigPath(): string {
    const env = { ...process.env, ...this.runtimeSettings?.env };
    const agentDir = resolveOmpDiagnosticPaths(env).agentDir;
    const ymlPath = join(agentDir, "models.yml");
    if (existsSync(ymlPath)) return ymlPath;
    const yamlPath = join(agentDir, "models.yaml");
    return existsSync(yamlPath) ? yamlPath : ymlPath;
  }

  private resolveLaunchMode(modeId: string | undefined): {
    modeId: string;
    extraArgs: string[];
  } {
    return resolveOmpLaunchMode(modeId, this.modelRoleParams);
  }

  private async resolveOmpLaunch(): Promise<ResolvedProviderLaunch> {
    return resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: "omp",
    });
  }
}

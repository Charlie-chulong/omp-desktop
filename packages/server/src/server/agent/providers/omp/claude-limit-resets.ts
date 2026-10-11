import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  OmpClaudeLimitResetConsumeResult,
  OmpClaudeLimitResetGrant,
  OmpClaudeLimitResets,
} from "@omp-desktop/protocol/messages";
import {
  OmpClaudeLimitResetConsumeRequestMessageSchema,
  OmpClaudeLimitResetConsumeResultSchema,
} from "@omp-desktop/protocol/messages";
import type { ClaudeAccountQuotaFetchOptions } from "./claude-account-quota.js";
import {
  CLAUDE_PROFILE_ENDPOINT,
  CLAUDE_USAGE_ENDPOINT,
  requestClaudeOAuth,
} from "./claude-oauth-api.js";

const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const TimestampSchema = z
  .string()
  .refine((value) => /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const GrantIdSchema = OmpClaudeLimitResetConsumeRequestMessageSchema.shape.grantId;
const GrantSchema = z
  .object({
    id: GrantIdSchema,
    label: z.string().nullable().optional(),
    resets_total: SafeCountSchema.min(1),
    resets_left: SafeCountSchema,
    starts_at: TimestampSchema.nullable().optional(),
    ends_at: TimestampSchema,
    clears: z.array(z.string()),
    paused: z.boolean().optional().default(false),
    usable_now: z.boolean().optional().default(false),
    use_requires_limit: z.boolean().optional().default(true),
    blocking: z.array(z.string()).optional().default([]),
    gives_back_weekly: z.boolean().optional().default(false),
  })
  .refine((grant) => grant.resets_left <= grant.resets_total);
const InventorySchema = z.object({
  eligible: z.boolean(),
  ineligible_reason: z.string().nullable().optional(),
  at_limit: z.boolean().optional().default(false),
  exhausted: z.array(z.string()).optional().default([]),
  grants: z.unknown().optional(),
  next_grant_id: GrantIdSchema.nullable().optional(),
  cooldown_until: TimestampSchema.nullable().optional(),
});
const GrantsSchema = z.array(GrantSchema);
const UsageSchema = z.object({ cedar_ember: z.unknown().optional() });
const OrganizationUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const ProfileSchema = z.object({
  organization: z.object({ uuid: OrganizationUuidSchema }),
  account: z.object({ uuid: OrganizationUuidSchema }).optional(),
});
const ConsumeResponseSchema = z.object({
  result: OmpClaudeLimitResetConsumeResultSchema.shape.result,
  reason: z.string().nullable().optional(),
  resets_left: SafeCountSchema.nullable().optional(),
  cleared: z.array(z.string()).optional(),
  weekly_resets_at: TimestampSchema.nullable().optional(),
  cooldown_until: TimestampSchema.nullable().optional(),
});

export function unavailableClaudeLimitResets(
  status: "unavailable" | "error",
  error: string,
): OmpClaudeLimitResets {
  return {
    status,
    eligible: null,
    availableCount: null,
    grants: [],
    nextGrantId: null,
    atLimit: false,
    exhausted: [],
    cooldownUntil: null,
    ineligibleReason: null,
    error,
  };
}

function isHeldGrant(grant: z.infer<typeof GrantSchema>, now: number): boolean {
  const startsAt = grant.starts_at ?? null;
  return (
    !grant.paused &&
    grant.resets_left > 0 &&
    (startsAt === null || Date.parse(startsAt) <= now) &&
    Date.parse(grant.ends_at) > now
  );
}

export function parseClaudeLimitResets(payload: unknown, now: number): OmpClaudeLimitResets {
  const usage = UsageSchema.safeParse(payload);
  const rawInventory = usage.success ? usage.data.cedar_ember : undefined;
  if (rawInventory === undefined || rawInventory === null) {
    return unavailableClaudeLimitResets(
      "unavailable",
      "Claude limit reset inventory is unavailable",
    );
  }
  const inventory = InventorySchema.safeParse(rawInventory);
  if (!inventory.success) {
    return unavailableClaudeLimitResets("error", "Claude limit reset inventory was malformed");
  }
  const data = inventory.data;
  const base = {
    eligible: data.eligible,
    atLimit: data.at_limit,
    exhausted: data.exhausted,
    cooldownUntil: data.cooldown_until ?? null,
    ineligibleReason: data.ineligible_reason ?? null,
  };
  const parsedGrants = GrantsSchema.safeParse(data.grants);
  if (!parsedGrants.success) {
    const missing = data.grants === undefined || data.grants === null;
    return {
      ...unavailableClaudeLimitResets(
        missing ? "unavailable" : "error",
        missing
          ? "Claude limit reset grants are unavailable"
          : "Claude limit reset grants were malformed",
      ),
      ...base,
    };
  }
  const ids = new Set<string>();
  const grants: OmpClaudeLimitResetGrant[] = [];
  let availableCount = 0;
  for (const grant of parsedGrants.data) {
    if (ids.has(grant.id)) {
      return {
        ...unavailableClaudeLimitResets(
          "error",
          "Claude limit reset inventory contained duplicate IDs",
        ),
        ...base,
      };
    }
    ids.add(grant.id);
    const active = isHeldGrant(grant, now);
    if (active) {
      availableCount += grant.resets_left;
      if (!Number.isSafeInteger(availableCount)) {
        return {
          ...unavailableClaudeLimitResets(
            "error",
            "Claude limit reset inventory count was malformed",
          ),
          ...base,
        };
      }
    }
    grants.push({
      id: grant.id,
      label: grant.label?.trim() || null,
      resetsTotal: grant.resets_total,
      resetsLeft: grant.resets_left,
      startsAt: grant.starts_at ?? null,
      endsAt: grant.ends_at,
      clears: grant.clears,
      paused: grant.paused,
      usableNow: grant.usable_now,
      useRequiresLimit: grant.use_requires_limit,
      blocking: grant.blocking,
      givesBackWeekly: grant.gives_back_weekly,
    });
  }
  return {
    status: "available",
    ...base,
    availableCount,
    grants,
    nextGrantId: data.next_grant_id && ids.has(data.next_grant_id) ? data.next_grant_id : null,
  };
}

function isUsableGrant(
  inventory: OmpClaudeLimitResets,
  grant: OmpClaudeLimitResetGrant | undefined,
  now: number,
): boolean {
  if (!inventory.eligible || !grant) return false;
  const affectsScope = (scope: string) =>
    grant.clears.includes(scope) || (grant.givesBackWeekly && scope === "seven_day");
  return (
    !grant.paused &&
    grant.usableNow &&
    grant.resetsLeft > 0 &&
    (grant.startsAt === null || Date.parse(grant.startsAt) <= now) &&
    Date.parse(grant.endsAt) > now &&
    (inventory.cooldownUntil === null || Date.parse(inventory.cooldownUntil) <= now) &&
    !grant.blocking.some((scope) => !affectsScope(scope)) &&
    (grant.clears.length > 0 || grant.givesBackWeekly) &&
    (!grant.useRequiresLimit || (inventory.atLimit && inventory.exhausted.some(affectsScope)))
  );
}

async function resolveAccountOrganization(
  options: ClaudeAccountQuotaFetchOptions,
  fallbackAccountKey: string,
  storedAccountId: string | undefined,
): Promise<{ accountKey: string; organizationUuid: string }> {
  const storedOrg = OrganizationUuidSchema.safeParse(options.credential.orgId);
  if (storedOrg.success && storedAccountId) {
    return { accountKey: storedAccountId, organizationUuid: storedOrg.data };
  }
  const profile = ProfileSchema.safeParse(
    await requestClaudeOAuth(options, CLAUDE_PROFILE_ENDPOINT, {
      resource: "profile",
    }),
  );
  if (!profile.success) throw new Error("The selected Claude account organization is unavailable");
  return {
    accountKey: storedAccountId || profile.data.account?.uuid || fallbackAccountKey,
    organizationUuid: storedOrg.success ? storedOrg.data : profile.data.organization.uuid,
  };
}

interface PendingConsumption {
  grantId: string;
  redeemRequestId: string;
  promise: Promise<OmpClaudeLimitResetConsumeResult>;
}
const pendingConsumptions = new Map<string, PendingConsumption>();

function joinPending(
  pending: PendingConsumption,
  grantId: string,
  redeemRequestId: string,
): Promise<OmpClaudeLimitResetConsumeResult> {
  if (pending.grantId !== grantId || pending.redeemRequestId !== redeemRequestId) {
    throw new Error("A limit reset is already being consumed for this Claude account");
  }
  return pending.promise;
}

export async function consumeClaudeLimitReset(
  options: ClaudeAccountQuotaFetchOptions & { grantId: string; redeemRequestId: string },
): Promise<OmpClaudeLimitResetConsumeResult> {
  if (
    !GrantIdSchema.safeParse(options.grantId).success ||
    !OmpClaudeLimitResetConsumeRequestMessageSchema.shape.redeemRequestId.safeParse(
      options.redeemRequestId,
    ).success
  ) {
    throw new Error("A valid Claude grant and redemption request ID are required");
  }
  const accessToken = options.credential.accessToken.trim();
  if (!accessToken) throw new Error("Claude account credential is unavailable");
  const storedOrg = OrganizationUuidSchema.safeParse(options.credential.orgId);
  const parsedAccountId = OrganizationUuidSchema.safeParse(options.credential.accountId?.trim());
  const storedAccountId = parsedAccountId.success
    ? parsedAccountId.data
    : options.credential.accountId?.trim();
  const tokenKey = createHash("sha256").update(accessToken).digest("hex");
  // Until profile resolution, only the same selected credential can join an unknown organization.
  // Once resolved, account identity and organization must both match; grants are not global IDs.
  const accountKey = JSON.stringify([
    storedOrg.success ? storedAccountId || tokenKey : tokenKey,
    storedOrg.success ? storedOrg.data : null,
  ]);
  const active = pendingConsumptions.get(accountKey);
  if (active) return await joinPending(active, options.grantId, options.redeemRequestId);
  let resolve!: (result: OmpClaudeLimitResetConsumeResult) => void;
  let reject!: (reason: unknown) => void;
  const consumption = new Promise<OmpClaudeLimitResetConsumeResult>((onSuccess, onFailure) => {
    resolve = onSuccess;
    reject = onFailure;
  });
  const pending = {
    grantId: options.grantId,
    redeemRequestId: options.redeemRequestId,
    promise: consumption,
  };
  const keys = new Set([accountKey]);
  pendingConsumptions.set(accountKey, pending);
  async function perform(): Promise<OmpClaudeLimitResetConsumeResult> {
    const { accountKey: canonicalAccountKey, organizationUuid } = await resolveAccountOrganization(
      options,
      tokenKey,
      storedAccountId,
    );
    const organizationKey = JSON.stringify([canonicalAccountKey, organizationUuid]);
    const organizationActive = pendingConsumptions.get(organizationKey);
    if (organizationActive && organizationActive !== pending) {
      return await joinPending(organizationActive, options.grantId, options.redeemRequestId);
    }
    pendingConsumptions.set(organizationKey, pending);
    keys.add(organizationKey);
    const payload = await requestClaudeOAuth(options, CLAUDE_USAGE_ENDPOINT, { resource: "usage" });
    const now = (options.now ?? Date.now)();
    const inventory = parseClaudeLimitResets(payload, now);
    if (inventory.status !== "available")
      throw new Error(inventory.error ?? "Claude limit resets are unavailable");
    const grant = inventory.grants.find((entry) => entry.id === options.grantId);
    if (!isUsableGrant(inventory, grant, now)) {
      throw new Error("The selected Claude limit reset is not usable now or has expired");
    }
    // Exactly one POST. An uncertain outcome is deliberately not retried or refreshed here.
    const response = await requestClaudeOAuth(
      options,
      `https://api.anthropic.com/api/organizations/${organizationUuid}/reset_rate_limits`,
      {
        resource: "limit reset",
        timeoutMs: options.timeoutMs ?? 25_000,
        body: {
          program: "cedar_ember",
          grant_id: options.grantId,
          request_id: options.redeemRequestId,
        },
      },
    );
    const result = ConsumeResponseSchema.safeParse(response);
    if (!result.success)
      throw new Error("Claude limit reset response was malformed; redemption is unconfirmed");
    return {
      result: result.data.result,
      reason: result.data.reason ?? null,
      resetsLeft: result.data.resets_left ?? null,
      cleared: result.data.cleared ?? [],
      weeklyResetsAt: result.data.weekly_resets_at ?? null,
      cooldownUntil: result.data.cooldown_until ?? null,
    };
  }
  void perform()
    .finally(() => {
      for (const key of keys) {
        if (pendingConsumptions.get(key) === pending) pendingConsumptions.delete(key);
      }
    })
    .then(resolve, reject);
  return await consumption;
}

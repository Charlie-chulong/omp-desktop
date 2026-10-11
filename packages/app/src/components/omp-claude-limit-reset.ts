import type {
  OmpClaudeLimitResetConsumeResult,
  OmpClaudeLimitResetGrant,
  OmpClaudeLimitResets,
  OmpProviderManagement,
} from "@omp-desktop/protocol/messages";

type Account = NonNullable<OmpProviderManagement["loginProviders"][number]["accounts"]>[number];
export type GrantState =
  | "active"
  | "expired"
  | "notStarted"
  | "paused"
  | "empty"
  | "ineligible"
  | "unknownEligibility"
  | "cooldown"
  | "limitRequired"
  | "blocked"
  | "unusable"
  | "unavailable";
export function claudeGrantClearsScope(grant: OmpClaudeLimitResetGrant, scope: string): boolean {
  return grant.clears.includes(scope) || (grant.givesBackWeekly && scope === "seven_day");
}
export function claudeGrantScopes(grant: OmpClaudeLimitResetGrant): string[] {
  return grant.givesBackWeekly && !grant.clears.includes("seven_day")
    ? [...grant.clears, "seven_day"]
    : grant.clears;
}

export function claudeResetRefreshTimes(
  inventory: OmpClaudeLimitResets | undefined,
  observedAt: number,
): string[] {
  if (!Number.isFinite(observedAt)) return [];
  return [
    inventory?.cooldownUntil,
    ...(inventory?.grants.flatMap((grant) => [grant.startsAt, grant.endsAt]) ?? []),
  ].filter((value): value is string => typeof value === "string" && Date.parse(value) > observedAt);
}

function grantTimingState(grant: OmpClaudeLimitResetGrant, now: number): GrantState | null {
  const end = Date.parse(grant.endsAt);
  const start = grant.startsAt === null ? null : Date.parse(grant.startsAt);
  if (!Number.isFinite(end) || (start !== null && !Number.isFinite(start))) return "unusable";
  if (end <= now) return "expired";
  if (start !== null && start > now) return "notStarted";
  return null;
}

export function claudeGrantState(
  inventory: OmpClaudeLimitResets | undefined,
  grant: OmpClaudeLimitResetGrant,
  now: number,
): GrantState {
  if (inventory?.status !== "available") return "unavailable";
  if (inventory.eligible === false) return "ineligible";
  if (inventory.eligible !== true) return "unknownEligibility";
  const timing = grantTimingState(grant, now);
  if (timing) return timing;
  if (grant.paused) return "paused";
  if (!Number.isSafeInteger(grant.resetsLeft)) return "unusable";
  if (grant.resetsLeft <= 0) return "empty";
  if (inventory.cooldownUntil !== null) {
    const cooldown = Date.parse(inventory.cooldownUntil);
    if (!Number.isFinite(cooldown) || cooldown > now) return "cooldown";
  }
  if (grant.clears.length === 0 && !grant.givesBackWeekly) return "unusable";
  if (
    grant.useRequiresLimit &&
    (!inventory.atLimit ||
      !inventory.exhausted.some((scope) => claudeGrantClearsScope(grant, scope)))
  )
    return "limitRequired";
  if (grant.blocking.some((scope) => !claudeGrantClearsScope(grant, scope))) return "blocked";
  if (!grant.usableNow) return "unusable";
  return "active";
}

export function claudeResetCount(
  inventory: OmpClaudeLimitResets | undefined,
  now: number,
): number | null {
  if (
    inventory?.status !== "available" ||
    inventory.availableCount === null ||
    !Number.isSafeInteger(inventory.availableCount) ||
    inventory.availableCount < 0
  )
    return null;
  const count = inventory.grants.reduce((sum, grant) => {
    const end = Date.parse(grant.endsAt);
    const start = grant.startsAt === null ? null : Date.parse(grant.startsAt);
    return !grant.paused &&
      Number.isFinite(end) &&
      end > now &&
      (start === null || (Number.isFinite(start) && start <= now)) &&
      Number.isSafeInteger(grant.resetsLeft) &&
      grant.resetsLeft > 0
      ? sum + grant.resetsLeft
      : sum;
  }, 0);
  return Number.isSafeInteger(count) ? count : null;
}

interface Attempt {
  requestId: string;
  consumed: boolean;
  before: number;
  accountKey: string;
  grantId: string;
}
interface ResetAction {
  serverId: string;
  credentialId: number;
  grant: OmpClaudeLimitResetGrant;
  isCurrent(): boolean;
  confirm(): Promise<boolean>;
  refresh(afterMutation: boolean): Promise<OmpProviderManagement>;
  consume(requestId: string): Promise<OmpClaudeLimitResetConsumeResult>;
}
export interface ResetActionOutcome {
  result?: OmpClaudeLimitResetConsumeResult;
  error?: unknown;
  refreshError?: unknown;
  changed?: boolean;
}

function findAccount(management: OmpProviderManagement, credentialId: number): Account | undefined {
  const provider = management.loginProviders.find((item) => item.id === "anthropic");
  return provider?.authenticated
    ? provider.accounts?.find((item) => item.credentialId === credentialId)
    : undefined;
}

function matchesConfirmation(
  inventory: OmpClaudeLimitResets | undefined,
  selected: OmpClaudeLimitResetGrant | undefined,
  confirmed: OmpClaudeLimitResetGrant,
): selected is OmpClaudeLimitResetGrant {
  return (
    selected !== undefined &&
    claudeGrantState(inventory, selected, Date.now()) === "active" &&
    selected.givesBackWeekly === confirmed.givesBackWeekly &&
    selected.clears.length === confirmed.clears.length &&
    selected.clears.every((scope, index) => scope === confirmed.clears[index])
  );
}

// Locks include confirmation, fresh eligibility lookup and reconciliation, not just the POST.
export class ClaudeLimitResetActions {
  private readonly locks = new Set<string>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.revision;
  private notify() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  private accountKey(serverId: string, credentialId: number) {
    return JSON.stringify([serverId, credentialId]);
  }
  private grantKey(serverId: string, credentialId: number, grantId: string) {
    return JSON.stringify([serverId, credentialId, grantId]);
  }
  isBusy(serverId: string, credentialId: number) {
    return this.locks.has(this.accountKey(serverId, credentialId));
  }
  isAwaitingRefresh(serverId: string, credentialId: number, grantId: string) {
    return this.attempts.get(this.grantKey(serverId, credentialId, grantId))?.consumed === true;
  }
  reconcile(serverId: string, credentialId: number, inventory: OmpClaudeLimitResets | undefined) {
    if (inventory?.status !== "available") return;
    let changed = false;
    for (const [key, attempt] of this.attempts) {
      if (!attempt.consumed || attempt.accountKey !== this.accountKey(serverId, credentialId))
        continue;
      const grant = inventory.grants.find((item) => item.id === attempt.grantId);
      if (!grant || grant.resetsLeft < attempt.before) {
        this.attempts.delete(key);
        changed = true;
      }
    }
    if (changed) this.notify();
  }
  async run(action: ResetAction): Promise<ResetActionOutcome> {
    const { serverId, credentialId, grant } = action;
    const accountKey = this.accountKey(serverId, credentialId);
    const key = this.grantKey(serverId, credentialId, grant.id);
    if (this.locks.has(accountKey) || this.attempts.get(key)?.consumed || !action.isCurrent())
      return {};
    this.locks.add(accountKey);
    this.notify();
    let result: OmpClaudeLimitResetConsumeResult | undefined;
    let error: unknown;
    let refreshError: unknown;
    try {
      if (!(await action.confirm()) || !action.isCurrent()) return {};
      const fresh = findAccount(await action.refresh(false), credentialId);
      if (!action.isCurrent()) return {};
      const inventory = fresh?.quota?.limitResets;
      const selected = inventory?.grants.find((item) => item.id === grant.id);
      if (!matchesConfirmation(inventory, selected, grant)) return { changed: true };
      const attempt = this.attempts.get(key) ?? {
        requestId: crypto.randomUUID(),
        consumed: false,
        before: selected.resetsLeft,
        accountKey,
        grantId: grant.id,
      };
      this.attempts.set(key, attempt);
      try {
        result = await action.consume(attempt.requestId);
        attempt.consumed = result.result === "reset" || result.result === "already_used";
        if (!attempt.consumed) this.attempts.delete(key);
        this.notify();
      } catch (cause) {
        // An unknown result keeps the same native-valid ID for the next explicit confirmation.
        error = cause;
      }
      try {
        const refreshed = findAccount(await action.refresh(true), credentialId);
        this.reconcile(serverId, credentialId, refreshed?.quota?.limitResets);
      } catch (cause) {
        refreshError = cause;
      }
      return { result, error, refreshError };
    } catch (cause) {
      return { error: cause };
    } finally {
      this.locks.delete(accountKey);
      this.notify();
    }
  }
}

export const claudeLimitResetActions = new ClaudeLimitResetActions();

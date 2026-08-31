import type { AgentProvider, ProviderSnapshotEntry } from "@omp-desktop/protocol/agent-types";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export const PROVIDERS_SNAPSHOT_QUERY_ROOT = "providersSnapshot";

export function normalizeProvidersSnapshotCwd(cwd?: string | null): string | null {
  return normalizeWorkspacePath(cwd);
}

export function providersSnapshotQueryRoot(serverId: string | null) {
  return [PROVIDERS_SNAPSHOT_QUERY_ROOT, serverId] as const;
}

export function providersSnapshotQueryKey(serverId: string | null, cwd?: string | null) {
  const normalizedCwd = normalizeProvidersSnapshotCwd(cwd);
  return normalizedCwd
    ? ([PROVIDERS_SNAPSHOT_QUERY_ROOT, serverId, "cwd", normalizedCwd] as const)
    : ([PROVIDERS_SNAPSHOT_QUERY_ROOT, serverId, "home"] as const);
}

export function providersSnapshotRequestOptions(input: {
  cwd?: string | null;
  providers?: AgentProvider[];
  ifNoneMatch?: string;
}) {
  const normalizedCwd = normalizeProvidersSnapshotCwd(input.cwd);
  return {
    ...(normalizedCwd ? { cwd: normalizedCwd } : {}),
    ...(input.providers ? { providers: input.providers } : {}),
    ...(input.ifNoneMatch ? { ifNoneMatch: input.ifNoneMatch } : {}),
  };
}

export function isProvidersSnapshotHomeScope(cwd?: string | null): boolean {
  return normalizeProvidersSnapshotCwd(cwd) === null;
}

/**
 * Loading and failed refreshes are transport states, not catalog replacements.
 * Keep the last usable catalog visible until a successful refresh supersedes it.
 */
export function mergeProvidersSnapshotHistory(
  entries: ProviderSnapshotEntry[],
  historicalEntries: readonly ProviderSnapshotEntry[] | undefined,
): ProviderSnapshotEntry[] {
  if (!historicalEntries?.length) return entries;
  const historicalByProvider = new Map(
    historicalEntries.map((entry) => [entry.provider, entry] as const),
  );
  return entries.map((entry) => {
    if (entry.status !== "loading" && entry.status !== "error") return entry;
    if ((entry.models?.length ?? 0) > 0) return entry;
    const historical = historicalByProvider.get(entry.provider);
    if ((historical?.models?.length ?? 0) === 0) return entry;
    return {
      ...historical,
      ...entry,
      models: historical?.models,
      modes: entry.modes ?? historical?.modes,
      fetchedAt: historical?.fetchedAt,
    };
  });
}

/** Transient snapshots must not replace the last successful disk cache. */
export function isProvidersSnapshotCacheable(entries: readonly ProviderSnapshotEntry[]): boolean {
  return entries.every((entry) => entry.status !== "loading" && entry.status !== "error");
}

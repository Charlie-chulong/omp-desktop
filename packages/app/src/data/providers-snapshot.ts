import type { AgentProvider, ProviderSnapshotEntry } from "@omp-desktop/protocol/agent-types";

export const PROVIDERS_SNAPSHOT_QUERY_ROOT = "providersSnapshot";

export function providersSnapshotQueryRoot(serverId: string | null) {
  return [PROVIDERS_SNAPSHOT_QUERY_ROOT, serverId] as const;
}

/** Every project on a host shares the same provider and model catalog. */
export function providersSnapshotQueryKey(serverId: string | null) {
  return providersSnapshotQueryRoot(serverId);
}

export function providersSnapshotRequestOptions(input: {
  providers?: AgentProvider[];
  ifNoneMatch?: string;
}) {
  return {
    ...(input.providers ? { providers: input.providers } : {}),
    ...(input.ifNoneMatch ? { ifNoneMatch: input.ifNoneMatch } : {}),
  };
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

import { useCallback } from "react";
import { useFetchQuery } from "@/data/query";
import type { OmpProviderManagement } from "@omp-desktop/protocol/messages";
import { useOmpProviderAccountNotes } from "@/hooks/use-omp-provider-account-notes";
import { resolveOmpModelProviderNamespace } from "@/provider-selection/omp-model-provider";
import { useSessionStore } from "@/stores/session-store";

type OmpAccountQuotaAccount = NonNullable<
  OmpProviderManagement["loginProviders"][number]["accounts"]
>[number];

export type OmpAccountQuotaDisplayAccount = OmpAccountQuotaAccount & { note?: string };

export const OMP_PROVIDER_MANAGEMENT_STALE_TIME_MS = 300_000;
export const OMP_PROVIDER_MANAGEMENT_GC_TIME_MS = 1_800_000;

export function ompProviderManagementQueryKey(serverId: string) {
  return ["ompProviderManagement", serverId] as const;
}

function isCodexProvider(provider: string | undefined, modelId: string | null): boolean {
  if (provider === "openai-codex") return true;
  return provider === "omp" && resolveOmpModelProviderNamespace(modelId ?? "") === "openai-codex";
}

interface OmpProviderManagementClient {
  getOmpProviderManagement(): Promise<OmpProviderManagement>;
}

function needsInitialQuotaRetry(management: OmpProviderManagement): boolean {
  const codex = management.loginProviders.find((provider) => provider.id === "openai-codex");
  if (!codex?.authenticated) return false;
  if (!codex.accounts || codex.accounts.length === 0) return true;
  return codex.accounts.some((account) => account.quota?.status !== "available");
}

function waitForInitialQuotaRetry(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 750);
  return promise;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export async function fetchOmpAccountQuotaManagement(
  client: OmpProviderManagementClient,
  waitForRetry: () => Promise<void> = waitForInitialQuotaRetry,
): Promise<OmpProviderManagement> {
  const first = await client.getOmpProviderManagement();
  if (!needsInitialQuotaRetry(first)) return first;
  await waitForRetry();
  return client.getOmpProviderManagement().catch(() => first);
}

export interface OmpCodexAccountQuotaResult {
  accounts: OmpAccountQuotaDisplayAccount[];
  provider: OmpProviderManagement["loginProviders"][number] | null;
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
  refresh: () => Promise<void>;
}

export function useOmpCodexAccountQuota(
  serverId: string | null | undefined,
  enabled = true,
): OmpCodexAccountQuotaResult {
  const client = useSessionStore((state) => state.sessions[serverId ?? ""]?.client ?? null);
  const supportsOmpProviderManagement = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.ompProviderManagement === true,
  );
  const canFetch = Boolean(client && supportsOmpProviderManagement);
  const active = enabled && canFetch;
  const accountNotes = useOmpProviderAccountNotes(active ? serverId : null);
  const query = useFetchQuery({
    queryKey: ompProviderManagementQueryKey(serverId ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("OMP provider management is unavailable");
      return fetchOmpAccountQuotaManagement(client);
    },
    enabled: active,
    dataShape: "value",
    staleTimeMs: 0,
    gcTime: OMP_PROVIDER_MANAGEMENT_GC_TIME_MS,
    refetchInterval: 300_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const refetchQuota = query.refetch;
  const refresh = useCallback(async () => {
    if (!active) return;
    await refetchQuota();
  }, [active, refetchQuota]);
  const provider = active
    ? (query.data?.loginProviders.find((entry) => entry.id === "openai-codex") ?? null)
    : null;
  const accounts = (provider?.accounts ?? []).map((account) =>
    Object.assign({}, account, {
      note: accountNotes.notes[String(account.credentialId)],
    }),
  );
  const updatedAtMs = query.dataUpdatedAt || query.errorUpdatedAt;

  return {
    accounts,
    provider,
    loading: active && (query.isFetching || accountNotes.loading),
    error: active && query.isError ? errorMessage(query.error) : null,
    updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null,
    refresh,
  };
}

export function useOmpAccountQuota(
  serverId: string | null | undefined,
  provider: string | null | undefined,
  modelId: string | null | undefined,
): { accounts: OmpAccountQuotaDisplayAccount[]; loading: boolean } {
  const shouldFetch = isCodexProvider(provider ?? undefined, modelId ?? null);
  const query = useOmpCodexAccountQuota(serverId, shouldFetch);
  return {
    accounts: shouldFetch ? query.accounts : [],
    loading: shouldFetch && query.loading,
  };
}

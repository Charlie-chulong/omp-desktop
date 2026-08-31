import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import type { OmpProviderManagement } from "@omp-desktop/protocol/messages";
import { loadOmpProviderAccountNotes } from "@/components/omp-provider-account-notes";
import { resolveOmpModelProviderNamespace } from "@/provider-selection/omp-model-provider";
import { useSessionStore } from "@/stores/session-store";

type OmpAccountQuotaAccount = NonNullable<
  OmpProviderManagement["loginProviders"][number]["accounts"]
>[number];

export type OmpAccountQuotaDisplayAccount = OmpAccountQuotaAccount & { note?: string };

function isCodexProvider(provider: string | undefined, modelId: string | null): boolean {
  if (provider === "openai-codex") return true;
  return provider === "omp" && resolveOmpModelProviderNamespace(modelId ?? "") === "openai-codex";
}

export function useOmpAccountQuota(
  serverId: string | null | undefined,
  provider: string | null | undefined,
  modelId: string | null | undefined,
): { accounts: OmpAccountQuotaDisplayAccount[]; loading: boolean } {
  const client = useSessionStore((state) => state.sessions[serverId ?? ""]?.client ?? null);
  const supportsOmpProviderManagement = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.ompProviderManagement === true,
  );
  const shouldFetch = isCodexProvider(provider ?? undefined, modelId ?? null);
  const query = useQuery({
    queryKey: ["ompWorkflowQuota", serverId ?? ""],
    queryFn: async () => {
      if (!client) throw new Error("OMP provider management is unavailable");
      return client.getOmpProviderManagement();
    },
    enabled: Boolean(client && supportsOmpProviderManagement && shouldFetch),
    staleTime: 0,
    refetchInterval: 300_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const notesQuery = useQuery({
    queryKey: ["ompProviderAccountNotes", serverId ?? ""],
    queryFn: () => loadOmpProviderAccountNotes(AsyncStorage, serverId ?? undefined),
    enabled: Boolean(serverId && shouldFetch),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const accounts = shouldFetch
    ? (query.data?.loginProviders.find((entry) => entry.id === "openai-codex")?.accounts ?? []).map(
        (account) => ({
          ...account,
          note: notesQuery.data?.[String(account.credentialId)],
        }),
      )
    : [];
  return { accounts, loading: query.isFetching || notesQuery.isFetching };
}

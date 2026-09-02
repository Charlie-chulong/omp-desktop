import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OmpProviderManagement } from "@omp-desktop/protocol/messages";
import { resolveOmpModelProviderNamespace } from "@/provider-selection/omp-model-provider";
import { useSessionStore } from "@/stores/session-store";

interface OmpModelContextTarget {
  providerId: string;
  modelId: string;
}

export function resolveOmpModelContextTarget(
  provider: string,
  modelId: string,
): OmpModelContextTarget | null {
  if (provider !== "omp") return null;
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return null;
  const providerId = resolveOmpModelProviderNamespace(normalizedModelId);
  const prefix = `${providerId}/`;
  if (!normalizedModelId.startsWith(prefix) || normalizedModelId.length === prefix.length) {
    return null;
  }
  return { providerId, modelId: normalizedModelId.slice(prefix.length) };
}

function findManagedModel(
  management: OmpProviderManagement | undefined,
  target: OmpModelContextTarget | null,
) {
  if (!management || !target) return null;
  return (
    management.providerModels
      .find((provider) => provider.id === target.providerId)
      ?.models?.find((model) => model.id === target.modelId) ?? null
  );
}

export function useOmpModelContextWindow(input: {
  serverId: string | null;
  provider: string;
  modelId: string;
  enabled: boolean;
}) {
  const { serverId, provider, modelId, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId ?? ""]?.client ?? null);
  const supportsManagement = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.ompProviderManagement === true,
  );
  const target = useMemo(
    () => resolveOmpModelContextTarget(provider, modelId),
    [modelId, provider],
  );
  const queryKey = useMemo(() => ["ompModelContextWindow", serverId ?? ""] as const, [serverId]);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!client) throw new Error("OMP provider management is unavailable");
      return client.getOmpProviderManagement();
    },
    enabled: Boolean(enabled && serverId && client && supportsManagement && target),
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: async (contextWindow: number | null) => {
      if (!client || !target)
        throw new Error("OMP model context-window configuration is unavailable");
      return client.updateOmpModelContextWindowOverrides(target.providerId, {
        [target.modelId]: contextWindow,
      });
    },
    onSuccess: (management) => {
      queryClient.setQueryData(queryKey, management);
    },
  });
  const save = useCallback(
    async (contextWindow: number | null) => {
      await mutation.mutateAsync(contextWindow);
    },
    [mutation],
  );
  const managedModel = findManagedModel(query.data, target);

  return {
    target,
    canEdit: Boolean(client && supportsManagement && target),
    reportedContextWindow: managedModel?.contextWindow,
    contextWindowOverride: managedModel?.contextWindowOverride,
    isLoading: query.isFetching,
    isSaving: mutation.isPending,
    error: mutation.error ?? query.error ?? null,
    save,
  };
}

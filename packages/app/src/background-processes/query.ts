import { useCallback, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export const backgroundProcessesQueryKey = (serverId: string, agentId: string) =>
  ["background-processes", serverId, agentId] as const;

function resolveBackgroundProcessesError(
  isSupported: boolean,
  isConnected: boolean,
  disconnectedMessage: string,
  queryError: string | undefined,
  responseError: string | null | undefined,
): string | null {
  if (!isSupported) return null;
  if (!isConnected) return disconnectedMessage;
  return queryError ?? responseError ?? null;
}

export function useBackgroundProcesses(serverId: string, agentId: string, enabled = true) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.backgroundProcesses === true,
  );
  const retainedActive = useRetainedPanelActive();
  const appVisible = useAppVisible();
  const [stoppingProcessIds, setStoppingProcessIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [stopError, setStopError] = useState<string | null>(null);
  const query = useFetchQuery({
    queryKey: backgroundProcessesQueryKey(serverId, agentId),
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return client.listBackgroundProcesses(agentId);
    },
    enabled:
      enabled &&
      isSupported &&
      retainedActive &&
      appVisible &&
      isConnected &&
      !!client &&
      !!agentId,
    dataShape: "value",
    refetchInterval: 2_000,
    staleTimeMs: 0,
    retry: false,
  });
  const refetchProcesses = query.refetch;
  const processes = query.data?.processes ?? [];
  const error = resolveBackgroundProcessesError(
    isSupported,
    isConnected,
    t("backgroundProcesses.disconnected"),
    query.error?.message,
    query.data?.error,
  );
  const stopProcess = useCallback(
    async (processId: string) => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      setStopError(null);
      setStoppingProcessIds((current) => new Set(current).add(processId));
      try {
        const response = await client.stopBackgroundProcess(agentId, processId);
        if (response.error) throw new Error(response.error);
        await refetchProcesses();
      } catch (stopProcessError) {
        const message =
          stopProcessError instanceof Error
            ? stopProcessError.message
            : t("backgroundProcesses.stopFailed");
        setStopError(message);
        throw stopProcessError;
      } finally {
        setStoppingProcessIds((current) => {
          const next = new Set(current);
          next.delete(processId);
          return next;
        });
      }
    },
    [agentId, client, refetchProcesses, t],
  );
  return {
    processes,
    error,
    stopError,
    isConnected,
    isLoading: query.isLoading,
    stoppingProcessIds,
    stopProcess,
  };
}

export type BackgroundProcessesState = ReturnType<typeof useBackgroundProcesses>;

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import {
  OmpStatsResultSchema,
  type OmpStatsRange,
  type OmpStatsResult,
} from "@omp-desktop/protocol/omp-stats";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export type OmpStatsView =
  | { kind: "loading" }
  | { kind: "error"; reason: "hostUnavailable" | "hostUpgradeRequired" | "requestFailed" }
  | { kind: "ready"; stats: OmpStatsResult; isRefreshing: boolean; refreshFailed: boolean };

export function ompStatsQueryKey(serverId: string, range: OmpStatsRange) {
  return ["ompStats", serverId, range] as const;
}

export function useOmpStats(
  serverId: string,
  range: OmpStatsRange,
): {
  view: OmpStatsView;
  refresh: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ompStats === true,
  );
  const canFetch = Boolean(serverId && client && connected && supported);
  const query = useFetchQuery({
    queryKey: ompStatsQueryKey(serverId, range),
    dataShape: "value",
    queryFn: async () => {
      if (!client) throw new Error("Host client unavailable");
      const payload = await client.getOmpStats({ range });
      const stats = OmpStatsResultSchema.parse(payload.stats);
      if (stats.range !== range) throw new Error("Native statistics range mismatch");
      return stats;
    },
    enabled: canFetch,
    staleTimeMs: 60_000,
    retry: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const { refetch } = query;
  const refresh = useCallback(async () => {
    if (!canFetch) return;
    // Every range is a view of the same native index, not an independent snapshot.
    await queryClient.invalidateQueries({
      queryKey: ["ompStats", serverId],
      refetchType: "none",
    });
    await refetch();
  }, [canFetch, queryClient, refetch, serverId]);
  const view = useMemo<OmpStatsView>(() => {
    if (!serverId || !client || !connected) return { kind: "error", reason: "hostUnavailable" };
    if (!supported) return { kind: "error", reason: "hostUpgradeRequired" };
    if (query.data)
      return {
        kind: "ready",
        stats: query.data,
        isRefreshing: query.isFetching,
        refreshFailed: query.isError,
      };
    if (query.isError) return { kind: "error", reason: "requestFailed" };
    return { kind: "loading" };
  }, [client, connected, query.data, query.isError, query.isFetching, serverId, supported]);
  return { view, refresh };
}

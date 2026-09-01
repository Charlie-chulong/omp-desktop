import { useCallback } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import {
  removeAgentFromCachedLists,
  type AgentHistoryQueryData,
  type AgentHistoryQueryPage,
} from "./use-archive-agent";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "./agent-history-query-key";

export interface DeleteAgentInput {
  serverId: string;
  agentId: string;
  workspaceId?: string;
}

type DeleteAgentClient = Pick<DaemonClient, "deleteAgent" | "deleteWorkspace">;

export async function deleteAgentOrWorkspace(
  client: DeleteAgentClient,
  input: DeleteAgentInput,
): Promise<void> {
  if (!input.workspaceId) {
    await client.deleteAgent(input.agentId);
    return;
  }
  const result = await client.deleteWorkspace(input.workspaceId);
  if (result.error) {
    throw new Error(result.error);
  }
}

function removeAgentFromHistoryPage(
  page: AgentHistoryQueryPage,
  input: DeleteAgentInput,
): AgentHistoryQueryPage {
  if (!Array.isArray(page.agents)) {
    return page;
  }
  const agents = page.agents.filter(
    (agent) =>
      agent.id !== input.agentId || (agent.serverId != null && agent.serverId !== input.serverId),
  );
  return agents.length === page.agents.length ? page : { ...page, agents };
}

export function removeAgentFromHistoryPayload<T extends AgentHistoryQueryData | undefined>(
  payload: T,
  input: DeleteAgentInput,
): T {
  if (!payload || !Array.isArray(payload.pages) || !input.agentId) {
    return payload;
  }
  const pages = payload.pages.map((page) => removeAgentFromHistoryPage(page, input));
  const changed = pages.some((page, index) => page !== payload.pages?.[index]);
  return changed ? ({ ...payload, pages } as T) : payload;
}

function removeAgentFromHistoryCaches(queryClient: QueryClient, input: DeleteAgentInput): void {
  queryClient.setQueryData<AgentHistoryQueryData | undefined>(
    agentHistoryQueryKey(input.serverId),
    (current) => removeAgentFromHistoryPayload(current, input),
  );
  queryClient.setQueriesData<AgentHistoryQueryData | undefined>(
    { queryKey: allAgentHistoryQueryRootKey() },
    (current) => removeAgentFromHistoryPayload(current, input),
  );
}

function removeAgentFromStore(input: DeleteAgentInput): void {
  useSessionStore.getState().setAgents(input.serverId, (current) => {
    if (!current.has(input.agentId)) {
      return current;
    }
    const next = new Map(current);
    next.delete(input.agentId);
    return next;
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: DeleteAgentInput) => {
      const client = useSessionStore.getState().sessions[input.serverId]?.client;
      if (!client) {
        throw new Error(`Host ${input.serverId} is unavailable`);
      }
      await deleteAgentOrWorkspace(client, input);
      return input;
    },
    onSuccess: (input) => {
      removeAgentFromStore(input);
      removeAgentFromCachedLists(queryClient, input);
      removeAgentFromHistoryCaches(queryClient, input);
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", input.serverId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", input.serverId],
      });
      void queryClient.invalidateQueries({
        queryKey: agentHistoryQueryKey(input.serverId),
      });
      void queryClient.invalidateQueries({
        queryKey: allAgentHistoryQueryRootKey(),
      });
    },
  });

  const deleteAgent = useCallback(
    (input: DeleteAgentInput) => mutation.mutateAsync(input),
    [mutation.mutateAsync],
  );

  return { deleteAgent, isDeleting: mutation.isPending };
}

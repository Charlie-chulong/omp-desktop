import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FetchAgentHistoryEntry } from "@omp-desktop/client/internal/daemon-client";
import { getParentAgentIdFromLabels } from "@omp-desktop/protocol/agent-labels";
import type { AgentSnapshotPayload } from "@omp-desktop/protocol/messages";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { isWorkspaceRootAgent, pickWorkspacePrimaryAgentId } from "@/subagents/policies";
import { toErrorMessage } from "@/utils/error-messages";

export function useSidebarWorkspaceFork(workspace: SidebarWorkspaceEntry): {
  canFork: boolean;
  isForking: boolean;
  fork: () => Promise<void>;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[workspace.serverId]?.client ?? null);
  const supportsFork = useHostFeature(workspace.serverId, "agentForkContext");
  const forkAgent = useForkAgent({ serverId: workspace.serverId, toast });
  const [isForking, setIsForking] = useState(false);
  const forkInProgress = useRef(false);
  // A single conversation's root isn't exposed by the sidebar model; when it is
  // not already loaded, the history endpoint can resolve it on demand.
  const canFork = supportsFork && client !== null && !!workspace.workspaceId.trim();

  const fork = useCallback(async () => {
    if (forkInProgress.current) return;
    if (!canFork || !client) {
      toast.error(t("message.actions.forkUnavailable"));
      return;
    }

    forkInProgress.current = true;
    setIsForking(true);
    try {
      const entries: FetchAgentHistoryEntry[] = [];
      let cursor: string | null = null;
      do {
        const history = await client.fetchAgentHistory({
          filter: { includeArchived: true, workspaceIds: [workspace.workspaceId] },
          sort: [{ key: "created_at", direction: "asc" }],
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        entries.push(...history.entries);
        cursor = history.pageInfo.hasMore ? history.pageInfo.nextCursor : null;
      } while (cursor);

      const byId = new Map(entries.map(({ agent }) => [agent.id, agent]));
      const unknownParents = new Map<string, AgentSnapshotPayload | undefined>();
      // A conversation fork must target a workspace root, not a child whose
      // parent wasn't returned in this workspace's history.
      for (const { agent } of entries) {
        const parentId = getParentAgentIdFromLabels(agent.labels);
        if (parentId && !byId.has(parentId) && !unknownParents.has(parentId)) {
          unknownParents.set(parentId, (await client.fetchAgent({ agentId: parentId }))?.agent);
        }
      }
      const roots = entries.filter(({ agent }) => {
        const parentAgentId = getParentAgentIdFromLabels(agent.labels);
        return isWorkspaceRootAgent(
          { workspaceId: agent.workspaceId, parentAgentId },
          parentAgentId
            ? (byId.get(parentAgentId) ?? unknownParents.get(parentAgentId))
            : undefined,
        );
      });
      const agentId = pickWorkspacePrimaryAgentId(
        roots.map(({ agent }) => ({
          id: agent.id,
          workspaceId: agent.workspaceId,
          parentAgentId: null,
          createdAt: agent.createdAt,
          archivedAt: agent.archivedAt,
        })),
        workspace.workspaceId,
      );
      const source = roots.find(({ agent }) => agent.id === agentId);
      if (!source) throw new Error(t("message.actions.forkFailed"));

      await forkAgent({
        agentId: source.agent.id,
        agent: { ...source.agent, projectPlacement: source.project },
      });
    } catch (error) {
      toast.error(toErrorMessage(error) || t("message.actions.forkFailed"));
    } finally {
      forkInProgress.current = false;
      setIsForking(false);
    }
  }, [canFork, client, forkAgent, t, toast, workspace.workspaceId]);

  return { canFork, isForking, fork };
}

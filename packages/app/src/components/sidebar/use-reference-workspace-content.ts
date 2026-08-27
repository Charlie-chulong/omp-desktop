import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  normalizeWorkspaceOpaqueId,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { getParentAgentIdFromLabels } from "@omp-desktop/protocol/agent-labels";

interface WorkspaceConversationAgent {
  id: string;
  workspaceId?: string | null;
  parentAgentId: string | null;
}

export function findWorkspaceConversationAgentId(
  agents: readonly WorkspaceConversationAgent[],
  workspaceId: string,
): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
  if (!normalizedWorkspaceId) return null;

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agent of agents) {
    if (normalizeWorkspaceOpaqueId(agent.workspaceId) !== normalizedWorkspaceId) continue;
    if (!agent.parentAgentId) return agent.id;

    const parent = agentsById.get(agent.parentAgentId);
    if (parent && normalizeWorkspaceOpaqueId(parent.workspaceId) !== normalizedWorkspaceId) {
      return agent.id;
    }
  }
  return null;
}

export function useReferenceWorkspaceContent(workspace: SidebarWorkspaceEntry) {
  const { t } = useTranslation();
  const toast = useToast();
  const activeWorkspace = useActiveWorkspaceSelection();
  const supportsAgentForkContext = useHostFeature(workspace.serverId, "agentForkContext");
  const activeWorkspaceKey = activeWorkspace
    ? buildWorkspaceTabPersistenceKey(activeWorkspace)
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    activeWorkspaceKey ? state.layoutByWorkspace[activeWorkspaceKey] : undefined,
  );
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const [isPending, setIsPending] = useState(false);
  const focusedChat = useMemo(
    () =>
      activeWorkspace
        ? resolveFocusedChatTarget({ serverId: activeWorkspace.serverId, layout })
        : null,
    [activeWorkspace, layout],
  );
  const canReferenceContent =
    supportsAgentForkContext && activeWorkspace !== null && focusedChat !== null;

  const referenceContent = useCallback(async () => {
    if (!activeWorkspace || !activeWorkspaceKey || !focusedChat || isPending) return;

    setIsPending(true);
    try {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));

      const history = await client.fetchAgentHistory({
        filter: { includeArchived: true, workspaceIds: [workspace.workspaceId] },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200 },
      });
      const agentId = findWorkspaceConversationAgentId(
        history.entries.map(({ agent }) => ({
          id: agent.id,
          workspaceId: agent.workspaceId,
          parentAgentId: getParentAgentIdFromLabels(agent.labels),
        })),
        workspace.workspaceId,
      );
      if (!agentId) throw new Error(t("sidebar.workspace.toasts.referenceContentFailed"));

      const payload = await client.buildAgentForkContext(agentId);
      if (!payload.attachment)
        throw new Error(t("sidebar.workspace.toasts.referenceContentFailed"));

      let scopeKey: string;
      if (focusedChat.kind === "draft") {
        scopeKey = buildDraftWorkspaceAttachmentScopeKey(focusedChat.draftId);
      } else {
        const session = useSessionStore.getState().sessions[activeWorkspace.serverId];
        const destinationWorkspaceId = resolveWorkspaceMapKeyByIdentity({
          workspaces: session?.workspaces,
          workspaceId: activeWorkspace.workspaceId,
        });
        const destinationWorkspace = destinationWorkspaceId
          ? session?.workspaces.get(destinationWorkspaceId)
          : undefined;
        if (!destinationWorkspace) {
          throw new Error(t("sidebar.workspace.toasts.referenceContentFailed"));
        }
        scopeKey = buildWorkspaceAttachmentScopeKey({
          serverId: activeWorkspace.serverId,
          workspaceId: destinationWorkspace.id,
          cwd: destinationWorkspace.workspaceDirectory,
        });
      }

      useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({
        scopeKey,
        attachment: {
          kind: "chat_history",
          id: `chat_history:${workspace.serverId}:${agentId}`,
          attachment: {
            ...payload.attachment,
            title: workspace.title ?? workspace.name,
          },
          source: {
            serverId: workspace.serverId,
            agentId,
            boundaryMessageId: payload.boundaryMessageId,
            boundaryCursor: payload.boundaryCursor,
            itemCount: payload.itemCount,
          },
        },
      });
      focusTab(activeWorkspaceKey, focusedChat.tabId);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("sidebar.workspace.toasts.referenceContentFailed"),
      );
    } finally {
      setIsPending(false);
    }
  }, [activeWorkspace, activeWorkspaceKey, focusTab, focusedChat, isPending, t, toast, workspace]);

  return { canReferenceContent, isPending, referenceContent };
}

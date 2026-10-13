import { router } from "expo-router";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { useSessionStore } from "@/stores/session-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { resolveProjectLayoutKey } from "@/workspace-tabs/project-scope";
import {
  redirectIfArchivingActiveWorkspace as redirectIfArchivingActiveWorkspacePure,
  type RedirectIfArchivingActiveWorkspaceInput,
} from "@/utils/workspace-archive-redirect";

export function redirectIfArchivingActiveWorkspace(
  input: RedirectIfArchivingActiveWorkspaceInput,
): boolean {
  return redirectIfArchivingActiveWorkspacePure(input, {
    navigateToWorkspace: ({ serverId, workspaceId }) => {
      const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
      const projectKey = resolveProjectLayoutKey({ serverId, workspaceId: input.workspaceId });
      const layout = projectKey
        ? useWorkspaceLayoutStore.getState().layoutByWorkspace[projectKey]
        : null;
      const pane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
      const target =
        layout && pane?.focusedTabId
          ? collectAllTabs(layout.root).find((tab) => tab.tabId === pane.focusedTabId)?.target
          : null;
      const owner = target?.workspaceId ? workspaces?.get(target.workspaceId) : null;
      // The route can still belong to the archived conversation while a new
      // conversation in the same project owns the focused tab.
      if (
        target &&
        owner &&
        owner.id !== input.workspaceId &&
        owner.projectId === workspaces?.get(input.workspaceId)?.projectId &&
        !owner.archivingAt
      ) {
        navigateToWorkspace({ serverId, workspaceId: owner.id, target });
      } else {
        navigateToWorkspace({ serverId, workspaceId, restoreProjectSelection: true });
      }
    },
    navigateToOpenProject: () => router.replace(buildOpenProjectRoute()),
    readWorkspaces: (serverId) =>
      useSessionStore.getState().sessions[serverId]?.workspaces.values() ?? [],
  });
}

import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceArchiveDestination } from "@/utils/workspace-archive-navigation";

export interface RedirectIfArchivingActiveWorkspaceInput {
  serverId: string;
  workspaceId: string;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
}

export interface RedirectIfArchivingActiveWorkspaceDeps {
  navigateToWorkspace: (input: { serverId: string; workspaceId: string }) => void;
  navigateToOpenProject: () => void;
  readWorkspaces: (serverId: string) => Iterable<WorkspaceDescriptor>;
}

export function redirectIfArchivingActiveWorkspace(
  input: RedirectIfArchivingActiveWorkspaceInput,
  deps: RedirectIfArchivingActiveWorkspaceDeps,
): boolean {
  if (
    input.activeWorkspaceSelection?.serverId !== input.serverId ||
    input.activeWorkspaceSelection.workspaceId !== input.workspaceId
  ) {
    return false;
  }

  const destination = resolveWorkspaceArchiveDestination({
    archivedWorkspaceId: input.workspaceId,
    workspaces: deps.readWorkspaces(input.serverId),
  });
  if (destination.kind === "workspace") {
    deps.navigateToWorkspace({
      serverId: input.serverId,
      workspaceId: destination.workspaceId,
    });
  } else {
    deps.navigateToOpenProject();
  }
  return true;
}

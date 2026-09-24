import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { generateDraftId } from "@/stores/draft-keys";
import { resolveWorkspaceArchiveDestination } from "@/utils/workspace-archive-navigation";

export interface RedirectIfArchivingActiveWorkspaceInput {
  serverId: string;
  workspaceId: string;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
}

export interface RedirectIfArchivingActiveWorkspaceDeps {
  navigateToDraft: (input: { serverId: string; workspaceId: string; draftId: string }) => void;
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
    deps.navigateToDraft({
      serverId: input.serverId,
      workspaceId: destination.workspaceId,
      draftId: generateDraftId(),
    });
  } else {
    deps.navigateToOpenProject();
  }
  return true;
}

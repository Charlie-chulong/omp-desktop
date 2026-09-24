import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceRouteId } from "@/utils/workspace-identity";

export type WorkspaceArchiveDestination =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "open-project" };

export function resolveWorkspaceArchiveDestination(input: {
  archivedWorkspaceId: string;
  workspaces: Iterable<WorkspaceDescriptor>;
}): WorkspaceArchiveDestination {
  const archivedWorkspaceId = resolveWorkspaceRouteId({
    routeWorkspaceId: input.archivedWorkspaceId,
  });
  const workspaces = Array.from(input.workspaces);
  const archivedWorkspace = workspaces.find((workspace) => workspace.id === archivedWorkspaceId);
  if (!archivedWorkspace) return { kind: "open-project" };

  const siblings = workspaces.filter(
    (workspace) =>
      workspace.id !== archivedWorkspaceId &&
      workspace.projectId === archivedWorkspace.projectId &&
      !workspace.archivingAt,
  );
  const sibling =
    siblings.find(
      (workspace) => workspace.workspaceDirectory === archivedWorkspace.projectRootPath,
    ) ?? siblings[0];
  return sibling ? { kind: "workspace", workspaceId: sibling.id } : { kind: "open-project" };
}

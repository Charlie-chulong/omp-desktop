import { useWorkspaceFields } from "@/stores/session-store-hooks";

export function useVisibleWorkspaceBranch(serverId: string, workspaceId: string): string | null {
  return (
    useWorkspaceFields(serverId, workspaceId, (workspace) =>
      workspace.gitRuntime?.currentBranch?.trim(),
    ) || null
  );
}

export function useWorkspaceHasBranch(serverId: string, workspaceId: string): boolean {
  return Boolean(
    useWorkspaceFields(serverId, workspaceId, (workspace) =>
      Boolean(workspace.gitRuntime?.currentBranch?.trim()),
    ),
  );
}

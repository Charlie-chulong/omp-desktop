export interface FileExplorerWorkspaceScope {
  workspaceId?: string | null;
  workspaceRoot?: string | null;
}

function normalizeWorkspaceValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildWorkspaceExplorerStateKey(scope: FileExplorerWorkspaceScope): string | null {
  const workspaceId = normalizeWorkspaceValue(scope.workspaceId);
  if (workspaceId) return `workspace:${workspaceId}`;

  const workspaceRoot = normalizeWorkspaceValue(scope.workspaceRoot);
  return workspaceRoot ? `root:${workspaceRoot}` : null;
}

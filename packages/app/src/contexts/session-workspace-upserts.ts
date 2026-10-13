import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

interface PendingWorkspaceArchive {
  workspaceId: string;
}

const pendingWorkspaceArchivesByServer = new Map<string, Map<string, PendingWorkspaceArchive>>();

function pendingArchiveKey(input: { serverId: string; workspaceId: string }): string {
  return `${input.serverId.trim()}::${input.workspaceId.trim()}`;
}

export function markWorkspaceArchivePending(input: {
  serverId: string;
  workspaceId: string;
}): void {
  const serverId = input.serverId.trim();
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!serverId || !workspaceId) {
    return;
  }

  const archives = pendingWorkspaceArchivesByServer.get(serverId) ?? new Map();
  archives.set(pendingArchiveKey({ serverId, workspaceId }), {
    workspaceId,
  });
  pendingWorkspaceArchivesByServer.set(serverId, archives);
}

export function clearWorkspaceArchivePending(input: {
  serverId: string;
  workspaceId: string;
}): void {
  const serverId = input.serverId.trim();
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!serverId || !workspaceId) {
    return;
  }

  const archives = pendingWorkspaceArchivesByServer.get(serverId);
  if (!archives) {
    return;
  }
  archives.delete(pendingArchiveKey({ serverId, workspaceId }));
  if (archives.size === 0) {
    pendingWorkspaceArchivesByServer.delete(serverId);
  }
}

export function isWorkspaceArchivePending(input: {
  serverId: string;
  workspaceId?: string | null;
}): boolean {
  const serverId = input.serverId.trim();
  if (!serverId) {
    return false;
  }

  const archives = pendingWorkspaceArchivesByServer.get(serverId);
  if (!archives) {
    return false;
  }

  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  return Boolean(workspaceId && archives.has(pendingArchiveKey({ serverId, workspaceId })));
}

/**
 * Workspace ids whose records are temporarily hidden by an in-flight local
 * archive. Owners here may be restored on failure, so consumers must not treat
 * them as permanently gone (e.g. dead-owner draft pruning).
 */
export function listWorkspaceArchivePendingIds(serverId: string): string[] {
  const archives = pendingWorkspaceArchivesByServer.get(serverId.trim());
  return archives ? [...archives.values()].map((entry) => entry.workspaceId) : [];
}

export function shouldSuppressWorkspaceForLocalArchive(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
}): boolean {
  return isWorkspaceArchivePending({
    serverId: input.serverId,
    workspaceId: input.workspace.id,
  });
}

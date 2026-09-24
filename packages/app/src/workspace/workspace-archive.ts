import {
  clearWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/contexts/session-workspace-upserts";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { i18n } from "@/i18n/i18next";
import { useCreateFlowStore } from "@/stores/create-flow-store";

export interface WorkspaceArchiveTarget {
  serverId: string;
  workspaceId: string;
}

interface WorkspaceArchiveClient {
  archiveWorkspace: (
    workspaceId: string,
    options?: { onlyIfEmpty?: boolean },
  ) => Promise<{ error: string | null; skipped?: boolean; archivedAt?: string | null }>;
}

interface OptimisticWorkspaceArchiveSnapshot {
  workspace: WorkspaceDescriptor | null;
}

export interface WorkspaceArchiveFailure {
  serverId: string;
  workspaceId: string;
  error: unknown;
}

function isWorkspaceArchiveFailure(error: unknown): error is WorkspaceArchiveFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "serverId" in error &&
    typeof error.serverId === "string" &&
    "workspaceId" in error &&
    typeof error.workspaceId === "string" &&
    "error" in error
  );
}

function hideWorkspaceOptimistically(
  workspace: WorkspaceArchiveTarget,
): OptimisticWorkspaceArchiveSnapshot {
  const workspaces = useSessionStore.getState().sessions[workspace.serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: workspace.workspaceId,
  });
  const snapshot = workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
  markWorkspaceArchivePending({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  useSessionStore.getState().removeWorkspace(workspace.serverId, workspace.workspaceId);
  return { workspace: snapshot };
}

function restoreOptimisticallyHiddenWorkspace(input: {
  serverId: string;
  workspaceId: string;
  snapshot: OptimisticWorkspaceArchiveSnapshot;
}): void {
  clearWorkspaceArchivePending({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (input.snapshot.workspace) {
    useSessionStore.getState().mergeWorkspaces(input.serverId, [input.snapshot.workspace]);
  }
}

async function archiveWorkspaceOrThrow(input: {
  client: WorkspaceArchiveClient;
  workspaceId: string;
}): Promise<void> {
  const payload = await input.client.archiveWorkspace(input.workspaceId);
  if (payload.error) {
    throw new Error(payload.error);
  }
}

export async function archiveWorkspaceOptimistically(input: {
  client: WorkspaceArchiveClient;
  workspace: WorkspaceArchiveTarget;
}): Promise<void> {
  const snapshot = hideWorkspaceOptimistically(input.workspace);

  try {
    await archiveWorkspaceOrThrow({
      client: input.client,
      workspaceId: input.workspace.workspaceId,
    });
  } catch (error) {
    restoreOptimisticallyHiddenWorkspace({
      serverId: input.workspace.serverId,
      workspaceId: input.workspace.workspaceId,
      snapshot,
    });
    throw error;
  }
}

// Unlike explicit archives, closing an unused conversation must not hide anything
// until the server has checked its persisted history and live resources.
export async function archiveEmptyWorkspace(input: {
  client: WorkspaceArchiveClient | null;
  workspace: WorkspaceArchiveTarget;
  closedDraftId?: string;
  hasPendingTerminalCreate: boolean;
}): Promise<void> {
  const { serverId, workspaceId } = input.workspace;
  if (input.hasPendingTerminalCreate) {
    return;
  }
  for (const pending of Object.values(useCreateFlowStore.getState().pendingByDraftId)) {
    if (
      pending.serverId === serverId &&
      (pending.workspaceId === workspaceId || pending.draftId === input.closedDraftId)
    ) {
      // Even an abandoned request may still be creating an agent on the server.
      return;
    }
  }
  if (!input.client) {
    throw new Error(i18n.t("sidebar.workspace.toasts.hostDisconnected"));
  }
  if (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.workspaceArchiveIfEmpty !==
    true
  ) {
    // Older daemons strip unknown request fields and would archive unconditionally.
    throw new Error(i18n.t("sidebar.workspace.toasts.updateHostToArchiveEmpty"));
  }
  const payload = await input.client.archiveWorkspace(workspaceId, { onlyIfEmpty: true });
  if (payload.error) {
    throw new Error(payload.error);
  }
  if (payload.skipped) {
    return;
  }
  if (!payload.archivedAt) {
    throw new Error(i18n.t("sidebar.workspace.toasts.archiveFailed"));
  }
  markWorkspaceArchivePending(input.workspace);
  useSessionStore.getState().removeWorkspace(serverId, workspaceId);
}

export async function archiveWorkspacesOptimistically(input: {
  getClient: (serverId: string) => WorkspaceArchiveClient | null;
  workspaces: WorkspaceArchiveTarget[];
}): Promise<WorkspaceArchiveFailure[]> {
  const results = await Promise.allSettled(
    input.workspaces.map(async (workspace) => {
      const client = input.getClient(workspace.serverId);
      if (!client) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error: new Error(i18n.t("sidebar.workspace.toasts.hostDisconnected")),
        } satisfies WorkspaceArchiveFailure;
      }

      try {
        await archiveWorkspaceOptimistically({
          client,
          workspace,
        });
      } catch (error) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error,
        } satisfies WorkspaceArchiveFailure;
      }
    }),
  );

  return results.flatMap((result) =>
    result.status === "rejected" && isWorkspaceArchiveFailure(result.reason) ? [result.reason] : [],
  );
}

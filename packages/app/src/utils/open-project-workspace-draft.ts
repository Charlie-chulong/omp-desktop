import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { generateDraftId } from "@/stores/draft-keys";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import { remapDraftCwdToWorkspace } from "@/utils/remap-draft-cwd-to-workspace";

export async function openProjectWorkspaceDraft(input: {
  serverId: string;
  projectId: string;
  projectRootPath: string;
  draftId?: string;
  setup?: WorkspaceDraftTabSetup;
  sourceDirectory?: string;
}): Promise<void> {
  const { serverId, projectId, projectRootPath } = input;
  if (!serverId.trim() || !projectId.trim() || !projectRootPath.trim()) {
    throw new Error("A host and project are required to open an agent draft");
  }

  const session = useSessionStore.getState().sessions[serverId];
  if (!session?.client) throw new Error("Host is unavailable");
  const payload = await session.client.createWorkspace({
    source: { kind: "directory", path: projectRootPath, projectId },
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? "Unable to create workspace");
  }
  const workspace = normalizeWorkspaceDescriptor(payload.workspace);
  useSessionStore.getState().mergeWorkspaces(serverId, [workspace]);
  const setup = input.setup
    ? {
        ...input.setup,
        cwd: remapDraftCwdToWorkspace({
          cwd: input.setup.cwd,
          sourceDirectory: input.sourceDirectory,
          workspaceDirectory: workspace.workspaceDirectory,
        }),
      }
    : undefined;
  navigateToWorkspace({
    serverId,
    workspaceId: workspace.id,
    target: {
      kind: "draft",
      draftId: input.draftId?.trim() || generateDraftId(),
      ...(setup ? { setup } : {}),
    },
  });
}

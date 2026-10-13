import { generateDraftId } from "@/stores/draft-keys";
import { type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { resolveProjectLayoutKey } from "@/workspace-tabs/project-scope";

export interface PrepareWorkspaceTabInput {
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  pin?: boolean;
}

export interface PrepareWorkspaceTabDeps {
  openTab: (input: {
    workspaceKey: string;
    target: WorkspaceTabTarget;
    intent: "reveal";
  }) => string | null;
  pinAgent: (workspaceKey: string, agentId: string) => void;
  getProjectLayoutKey?: (serverId: string, workspaceId: string) => string | null;
}

function getPreparedTarget(target: WorkspaceTabTarget): WorkspaceTabTarget {
  if (target.kind !== "draft" || target.draftId.trim() !== "new") {
    return target;
  }
  return { ...target, draftId: generateDraftId() };
}

export function prepareWorkspaceTab(
  input: PrepareWorkspaceTabInput,
  deps: PrepareWorkspaceTabDeps,
): void {
  const target = getPreparedTarget(input.target);
  const ownerWorkspaceId = target.workspaceId?.trim() || input.workspaceId;
  const key = (
    deps.getProjectLayoutKey ??
    ((serverId, workspaceId) => resolveProjectLayoutKey({ serverId, workspaceId }))
  )(input.serverId, ownerWorkspaceId);
  if (!key) return;

  deps.openTab({
    workspaceKey: key,
    target: { ...target, workspaceId: ownerWorkspaceId },
    intent: "reveal",
  });
  if (input.pin && target.kind === "agent") {
    deps.pinAgent(key, target.agentId);
  }
}

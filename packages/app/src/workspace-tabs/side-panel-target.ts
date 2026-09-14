import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type WorkspaceTabZone = "workspace" | "terminal" | "side_panel";
export const DEFAULT_WORKSPACE_SIDE_PANEL_TARGET = {
  kind: "files",
} as const satisfies WorkspaceTabTarget;

export function getWorkspaceTabZone(target: WorkspaceTabTarget): WorkspaceTabZone {
  if (isWorkspaceSidePanelToolTarget(target)) {
    return "side_panel";
  }
  if (target.kind === "terminal" || target.kind === "background_process") {
    return "terminal";
  }
  return "workspace";
}

/** Targets that belong in the dedicated right-hand tools pane. */
export function isWorkspaceSidePanelToolTarget(target: WorkspaceTabTarget): boolean {
  if (target.kind === "files" || target.kind === "pull_request") {
    return true;
  }
  return target.kind === "working_diff" && !target.focusPath && target.focusRequestId === undefined;
}

// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { seedSessionWorkspaces } from "@/test/seed-session";
import { useVisibleWorkspaceBranch, useWorkspaceHasBranch } from "./workspace-branch";

const SERVER_ID = "branch-pill";
const WORKSPACE_ID = "workspace";

const workspace: WorkspaceDescriptor = {
  id: WORKSPACE_ID,
  projectId: "project",
  projectDisplayName: "Project",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
  status: "done",
  statusEnteredAt: null,
  archivingAt: null,
  diffStat: null,
  scripts: [],
  gitRuntime: { currentBranch: " feature/branch-pill " },
};

function setCurrentBranch(currentBranch: string | null): void {
  useSessionStore.getState().setWorkspaces(SERVER_ID, (workspaces) => {
    const next = new Map(workspaces);
    const current = next.get(WORKSPACE_ID);
    if (current) {
      next.set(WORKSPACE_ID, {
        ...current,
        gitRuntime: { ...current.gitRuntime, currentBranch },
      });
    }
    return next;
  });
}

describe("workspace branch pill state", () => {
  beforeEach(() => {
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedSessionWorkspaces(SERVER_ID, new Map([[WORKSPACE_ID, workspace]]));
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER_ID);
  });

  it("shows a trimmed branch and hides detached or blank branch state", () => {
    const branch = renderHook(() => useVisibleWorkspaceBranch(SERVER_ID, WORKSPACE_ID));
    const hasBranch = renderHook(() => useWorkspaceHasBranch(SERVER_ID, WORKSPACE_ID));

    expect(branch.result.current).toBe("feature/branch-pill");
    expect(hasBranch.result.current).toBe(true);

    act(() => setCurrentBranch("   "));
    expect(branch.result.current).toBeNull();
    expect(hasBranch.result.current).toBe(false);

    act(() => setCurrentBranch(null));
    expect(branch.result.current).toBeNull();
    expect(hasBranch.result.current).toBe(false);
  });
});

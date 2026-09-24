import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceArchiveDestination } from "@/utils/workspace-archive-navigation";
import {
  redirectIfArchivingActiveWorkspace,
  type RedirectIfArchivingActiveWorkspaceDeps,
} from "@/utils/workspace-archive-redirect";

function workspace(
  input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: "Project",
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo",
    projectKind: "git",
    workspaceKind: input.workspaceKind ?? "worktree",
    name: input.name ?? input.id,
    status: input.status ?? "done",
    archivingAt: input.archivingAt ?? null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
  };
}

it("routes an archived worktree to the surviving root workspace, not another project", () => {
  const destination = resolveWorkspaceArchiveDestination({
    archivedWorkspaceId: "feature",
    workspaces: [
      workspace({ id: "unrelated", projectId: "project-2" }),
      workspace({ id: "feature", workspaceDirectory: "/repo/worktrees/feature" }),
      workspace({ id: "main", workspaceKind: "checkout" }),
    ],
  });
  expect(destination).toEqual({ kind: "workspace", workspaceId: "main" });
});

it("returns the project chooser when archiving the project's last workspace", () => {
  expect(
    resolveWorkspaceArchiveDestination({
      archivedWorkspaceId: "main",
      workspaces: [workspace({ id: "main", workspaceKind: "checkout" })],
    }),
  ).toEqual({ kind: "open-project" });
});

describe("redirectIfArchivingActiveWorkspace", () => {
  const input = {
    serverId: "server-1",
    workspaceId: "feature",
    activeWorkspaceSelection: { serverId: "server-1", workspaceId: "feature" },
  };

  it("leaves an inactive workspace's route untouched", () => {
    const navigateToDraft = vi.fn();
    const navigateToOpenProject = vi.fn();
    const deps: RedirectIfArchivingActiveWorkspaceDeps = {
      navigateToDraft,
      navigateToOpenProject,
      readWorkspaces: () => [workspace({ id: "feature" })],
    };
    expect(
      redirectIfArchivingActiveWorkspace(
        {
          ...input,
          activeWorkspaceSelection: { serverId: "server-1", workspaceId: "other" },
        },
        deps,
      ),
    ).toBe(false);
    expect(navigateToDraft).not.toHaveBeenCalled();
    expect(navigateToOpenProject).not.toHaveBeenCalled();
  });

  it("opens a new draft in the surviving workspace", () => {
    const navigateToDraft = vi.fn();
    const deps: RedirectIfArchivingActiveWorkspaceDeps = {
      navigateToDraft,
      navigateToOpenProject: vi.fn(),
      readWorkspaces: () => [
        workspace({ id: "feature", workspaceDirectory: "/repo/worktrees/feature" }),
        workspace({ id: "main", workspaceKind: "checkout" }),
      ],
    };
    expect(redirectIfArchivingActiveWorkspace(input, deps)).toBe(true);
    expect(navigateToDraft).toHaveBeenCalledWith({
      serverId: "server-1",
      workspaceId: "main",
      draftId: expect.any(String),
    });
  });

  it("opens project selection rather than racing archive with workspace creation", () => {
    const navigateToOpenProject = vi.fn();
    const deps: RedirectIfArchivingActiveWorkspaceDeps = {
      navigateToDraft: vi.fn(),
      navigateToOpenProject,
      readWorkspaces: () => [workspace({ id: "feature" })],
    };
    expect(redirectIfArchivingActiveWorkspace(input, deps)).toBe(true);
    expect(navigateToOpenProject).toHaveBeenCalledOnce();
  });
});

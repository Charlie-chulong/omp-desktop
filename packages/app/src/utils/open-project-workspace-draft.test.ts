import { beforeEach, expect, it, vi } from "vitest";
import { openProjectWorkspaceDraft } from "./open-project-workspace-draft";

const state = vi.hoisted(() => ({
  workspaces: new Map<string, Record<string, unknown>>(),
  createWorkspace: vi.fn(),
  mergeWorkspaces: vi.fn(),
  navigateToWorkspace: vi.fn(),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: state.navigateToWorkspace,
}));
vi.mock("@/stores/session-store", () => ({
  normalizeWorkspaceDescriptor: (workspace: unknown) => workspace,
  useSessionStore: {
    getState: () => ({
      sessions: {
        host: { workspaces: state.workspaces, client: { createWorkspace: state.createWorkspace } },
      },
      mergeWorkspaces: state.mergeWorkspaces,
    }),
  },
}));

const project = { serverId: "host", projectId: "project", projectRootPath: "/repo" };
const rootWorkspace = {
  id: "root-workspace",
  projectId: "project",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  status: "done",
  archivingAt: null,
};

beforeEach(() => {
  state.workspaces.clear();
  vi.clearAllMocks();
});

it("reuses the existing root workspace and opens the requested draft", async () => {
  state.workspaces.set("root-workspace", rootWorkspace);
  await openProjectWorkspaceDraft({ ...project, draftId: "fork-draft" });
  expect(state.createWorkspace).not.toHaveBeenCalled();
  expect(state.navigateToWorkspace).toHaveBeenCalledWith({
    serverId: "host",
    workspaceId: "root-workspace",
    target: { kind: "draft", draftId: "fork-draft" },
  });
});

it("creates and merges the root workspace before revealing a new draft", async () => {
  state.workspaces.set("archiving", {
    ...rootWorkspace,
    id: "archiving",
    archivingAt: "2026-09-01",
  });
  state.createWorkspace.mockResolvedValue({ workspace: rootWorkspace, error: null });
  await openProjectWorkspaceDraft(project);
  expect(state.createWorkspace).toHaveBeenCalledWith({
    source: { kind: "directory", path: "/repo", projectId: "project" },
  });
  expect(state.mergeWorkspaces).toHaveBeenCalledWith("host", [rootWorkspace]);
  expect(state.mergeWorkspaces.mock.invocationCallOrder[0]).toBeLessThan(
    state.navigateToWorkspace.mock.invocationCallOrder[0]!,
  );
  expect(state.navigateToWorkspace).toHaveBeenCalledWith({
    serverId: "host",
    workspaceId: "root-workspace",
    target: { kind: "draft", draftId: expect.any(String) },
  });
});

it("preserves a fork's setup and maps its cwd into the destination workspace", async () => {
  state.workspaces.set("root-workspace", rootWorkspace);
  await openProjectWorkspaceDraft({
    ...project,
    draftId: "fork-draft",
    sourceDirectory: "/repo/worktrees/feature",
    setup: {
      provider: "claude",
      cwd: "/repo/worktrees/feature/src",
      modeId: null,
      model: null,
      thinkingOptionId: null,
      featureValues: {},
    },
  });
  expect(state.navigateToWorkspace).toHaveBeenCalledWith({
    serverId: "host",
    workspaceId: "root-workspace",
    target: {
      kind: "draft",
      draftId: "fork-draft",
      setup: expect.objectContaining({ cwd: "/repo/src" }),
    },
  });
});

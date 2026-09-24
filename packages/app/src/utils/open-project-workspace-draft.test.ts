import { beforeEach, expect, it, vi } from "vitest";
import { openProjectWorkspaceDraft } from "./open-project-workspace-draft";
import { useGlobalNewWorkspaceAction } from "@/hooks/use-global-new-workspace-action";

const state = vi.hoisted(() => ({
  workspaces: new Map<string, Record<string, unknown>>(),
  createWorkspace: vi.fn(),
  mergeWorkspaces: vi.fn(),
  navigateToWorkspace: vi.fn(),
  registerHandler: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("expo-router", () => ({ router: { navigate: vi.fn() } }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: state.error }) }));
vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [{ serverId: "host" }] }));
vi.mock("@/hooks/use-keyboard-action-handler", () => ({
  useKeyboardActionHandler: state.registerHandler,
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: state.navigateToWorkspace,
  useActiveWorkspaceSelection: () => ({ serverId: "host", workspaceId: "root-workspace" }),
  getLastWorkspaceSelection: () => null,
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
  name: "hi",
  projectId: "project",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  status: "done",
  archivingAt: null,
};

beforeEach(() => {
  state.workspaces.clear();
  vi.resetAllMocks();
  let nextId = 0;
  state.createWorkspace.mockImplementation(async () => ({
    workspace: { ...rootWorkspace, id: `new-workspace-${++nextId}`, name: "main" },
    error: null,
  }));
  state.mergeWorkspaces.mockImplementation((_serverId, workspaces) => {
    for (const workspace of workspaces) state.workspaces.set(workspace.id, workspace);
  });
});

it("creates independent workspaces on repeated new-conversation actions without replacing hi", async () => {
  state.workspaces.set(rootWorkspace.id, rootWorkspace);
  useGlobalNewWorkspaceAction();
  const { handle } = state.registerHandler.mock.calls[0]![0];
  expect(handle()).toBe(true);
  await vi.waitFor(() => expect(state.navigateToWorkspace).toHaveBeenCalledTimes(1));
  expect(handle()).toBe(true);
  await vi.waitFor(() => expect(state.navigateToWorkspace).toHaveBeenCalledTimes(2));

  expect(state.workspaces.get(rootWorkspace.id)).toEqual(rootWorkspace);
  expect([...state.workspaces.keys()]).toEqual([
    "root-workspace", "new-workspace-1", "new-workspace-2",
  ]);
  const destinations = state.navigateToWorkspace.mock.calls.map(([destination]) => destination);
  expect(destinations.map((destination) => destination.workspaceId)).toEqual([
    "new-workspace-1", "new-workspace-2",
  ]);
  expect(destinations[0].target.draftId).not.toBe(destinations[1].target.draftId);
});

it("creates a new workspace even when the project already has a root workspace", async () => {
  state.workspaces.set(rootWorkspace.id, rootWorkspace);
  await openProjectWorkspaceDraft({ ...project, draftId: "new-draft" });
  expect(state.workspaces.get(rootWorkspace.id)?.name).toBe("hi");
  expect(state.navigateToWorkspace).toHaveBeenCalledWith({
    serverId: "host",
    workspaceId: "new-workspace-1",
    target: { kind: "draft", draftId: "new-draft" },
  });
});

it("preserves a fork's setup and maps its cwd into the new workspace", async () => {
  state.workspaces.set(rootWorkspace.id, rootWorkspace);
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
    workspaceId: "new-workspace-1",
    target: {
      kind: "draft",
      draftId: "fork-draft",
      setup: expect.objectContaining({ cwd: "/repo/src" }),
    },
  });
});

it("keeps the current conversation when workspace creation fails", async () => {
  state.workspaces.set(rootWorkspace.id, rootWorkspace);
  state.createWorkspace.mockResolvedValue({ workspace: null, error: "Host disconnected" });
  await expect(openProjectWorkspaceDraft(project)).rejects.toThrow("Host disconnected");
  expect(state.navigateToWorkspace).not.toHaveBeenCalled();
  expect([...state.workspaces.values()]).toEqual([rootWorkspace]);
});

import { afterEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

vi.mock("expo-router", () => ({
  router: { dismissTo: vi.fn(), replace: vi.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}));

import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { getLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  captureWorkspaceTabCleanup,
  closeWorkspaceAgentTabs,
} from "@/workspace/workspace-tab-cleanup";
import { redirectIfArchivingActiveWorkspace } from "./sidebar-workspace-archive-redirect";

const serverId = "archive-draft-retention";
const projectId = "project";
const projectKey = `${serverId}:project:${projectId}`;

function workspace(id: string): WorkspaceDescriptor {
  return {
    id,
    projectId,
    projectDisplayName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    projectKind: "git",
    workspaceKind: "checkout",
    name: id,
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

afterEach(() => {
  useSessionStore.getState().clearSession(serverId);
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
});

it("archives a draft's route host without adding a draft or replacing another conversation", () => {
  const session = useSessionStore.getState();
  session.initializeSession(serverId, null as unknown as DaemonClient);
  session.setWorkspaces(
    serverId,
    new Map(["first", "second", "new"].map((id) => [id, workspace(id)])),
  );
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  const layouts = useWorkspaceLayoutStore.getState();
  layouts.openTab({
    workspaceKey: projectKey,
    target: { kind: "agent", agentId: "first-agent", workspaceId: "first" },
    intent: "new",
  });
  layouts.openTab({
    workspaceKey: projectKey,
    target: { kind: "agent", agentId: "second-agent", workspaceId: "second" },
    intent: "new",
  });
  const draftTabId = layouts.openTab({
    workspaceKey: projectKey,
    target: { kind: "draft", draftId: "new-draft", workspaceId: "new" },
    intent: "new",
  });
  const cleanup = captureWorkspaceTabCleanup({ serverId, workspaceId: "first" });

  redirectIfArchivingActiveWorkspace({
    serverId,
    workspaceId: "first",
    activeWorkspaceSelection: { serverId, workspaceId: "first" },
  });
  session.removeWorkspace(serverId, "first");
  closeWorkspaceAgentTabs(cleanup);

  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[projectKey]!;
  expect(
    collectAllTabs(layout.root)
      .filter((tab) => tab.target.kind !== "new_tab")
      .map((tab) => tab.target),
  ).toEqual([
    { kind: "agent", agentId: "second-agent", workspaceId: "second" },
    { kind: "draft", draftId: "new-draft", workspaceId: "new" },
  ]);
  expect(findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId).toBe(draftTabId);
  expect(getLastWorkspaceSelection()).toEqual({ serverId, workspaceId: "new" });
});

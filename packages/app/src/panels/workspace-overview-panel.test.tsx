// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { workspaceOverviewPanelRegistration } from "@/panels/workspace-overview-panel";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  collectAllTabs,
  findPaneById,
  selectIsSidePanelVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { resolveProjectLayoutKey } from "@/workspace-tabs/project-scope";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

const SERVER_ID = "workspace-overview-test";
const WORKSPACE_ID = "workspace-backend";
const OVERVIEW_TARGET: WorkspaceTabTarget = {
  kind: "workspace_overview",
  workspaceId: WORKSPACE_ID,
};

function workspace(diffStat: WorkspaceDescriptor["diffStat"]): WorkspaceDescriptor {
  return {
    id: WORKSPACE_ID,
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: "/worktrees/backend",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "Dynamic MCP backend",
    title: "Dynamic MCP backend",
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat,
    scripts: [],
  };
}

function createOverviewPaneContext(input: {
  tabId: string;
  retargetCurrentTab: (target: WorkspaceTabTarget) => void;
}): PaneContextValue {
  return {
    serverId: SERVER_ID,
    workspaceId: WORKSPACE_ID,
    isSidePanel: false,
    tabId: input.tabId,
    target: OVERVIEW_TARGET,
    openTab: vi.fn(),
    closeCurrentTab: vi.fn(),
    retargetCurrentTab: input.retargetCurrentTab,
    setCurrentTabState: vi.fn(),
    openFileInWorkspace: vi.fn(),
    openImportSheet: vi.fn(),
  };
}

async function mountOverview(input: {
  tabId: string;
  retargetCurrentTab?: (target: WorkspaceTabTarget) => void;
}) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const Panel = workspaceOverviewPanelRegistration.component;
  const paneContext = createOverviewPaneContext({
    tabId: input.tabId,
    retargetCurrentTab: input.retargetCurrentTab ?? vi.fn(),
  });
  const render = async (isWorkspaceFocused: boolean) => {
    await act(async () =>
      root.render(
        <PaneProvider value={paneContext}>
          <PaneFocusProvider
            value={createPaneFocusContextValue({ isWorkspaceFocused, isPaneFocused: true })}
          >
            <Panel />
          </PaneFocusProvider>
        </PaneProvider>,
      ),
    );
  };
  await render(true);
  return {
    container,
    render,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

beforeEach(() => {
  useSessionStore.getState().initializeSession(SERVER_ID, {} as DaemonClient);
});

afterEach(() => {
  useSessionStore.setState((state) => ({ ...state, sessions: {} }));
  useWorkspaceLayoutStore.setState(useWorkspaceLayoutStore.getInitialState(), true);
});

it("starts a conversation in its own workspace from the overview tab", async () => {
  useSessionStore.getState().mergeWorkspaces(SERVER_ID, [workspace(null)]);
  const retargetCurrentTab = vi.fn();
  const view = await mountOverview({ tabId: "overview-tab", retargetCurrentTab });
  try {
    expect(view.container.textContent).toContain("Dynamic MCP backend");
    expect(view.container.textContent).toContain("workspace.overview.empty.title");

    const button = view.container.querySelector(
      '[data-testid="workspace-overview-new-conversation"]',
    );
    if (!(button instanceof HTMLElement)) throw new Error("New conversation action missing");
    fireEvent.click(button);

    expect(retargetCurrentTab).toHaveBeenCalledTimes(1);
    expect(retargetCurrentTab).toHaveBeenCalledWith({
      kind: "draft",
      draftId: expect.any(String),
      workspaceId: WORKSPACE_ID,
    });
  } finally {
    await view.unmount();
  }
});

it("opens its changes beside the overview once and keeps the overview focused", async () => {
  useSessionStore
    .getState()
    .mergeWorkspaces(SERVER_ID, [workspace({ additions: 3200, deletions: 750 })]);
  const projectKey = resolveProjectLayoutKey({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });
  if (!projectKey) throw new Error("Project layout key missing");
  const tabId = useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: projectKey,
    target: OVERVIEW_TARGET,
    intent: "reveal",
  });
  if (!tabId) throw new Error("Overview tab was not opened");

  const view = await mountOverview({ tabId });
  try {
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[projectKey]!;
    expect(
      collectAllTabs(layout.root).some(
        (tab) => tab.target.kind === "working_diff" && tab.target.workspaceId === WORKSPACE_ID,
      ),
    ).toBe(true);
    expect(selectIsSidePanelVisible(useWorkspaceLayoutStore.getState(), projectKey)).toBe(true);
    expect(findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId).toBe(tabId);

    useWorkspaceLayoutStore.getState().hideSidePanel(projectKey);
    await view.render(false);
    await view.render(true);

    expect(selectIsSidePanelVisible(useWorkspaceLayoutStore.getState(), projectKey)).toBe(false);
  } finally {
    await view.unmount();
  }
});

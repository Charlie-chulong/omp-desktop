import { describe, expect, it, vi } from "vitest";
import { resolveNavigateToAgent, type NavigateToAgentDeps } from "./resolve";
import {
  navigateToWorkspace,
  type NavigateToWorkspaceDeps,
} from "@/stores/navigation-active-workspace-store/navigation";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  collectAllPanes,
  createWorkspaceLayoutStore,
  findPaneById,
} from "@/stores/workspace-layout-store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const SERVER_ID = "server-1";
const HOST_ID = "workspace-host";
const OWNER_ID = "workspace-owner";
const OTHER_ID = "workspace-other";
const HOST_KEY = `${SERVER_ID}:project:project-a`;
const OTHER_KEY = `${SERVER_ID}:project:project-b`;
const AGENT_ID = "agent-y";

function createNavigation(agentWorkspaceId: string | null = OWNER_ID) {
  let nextId = 0;
  const store = createWorkspaceLayoutStore({
    createNodeId: (prefix) => `${prefix}_${++nextId}`,
    createFocusRestorationToken: () => `focus-${++nextId}`,
  });
  let route = `/h/${SERVER_ID}/workspace/${HOST_ID}`;
  let remembered: ActiveWorkspaceSelection | null = null;
  const workspaceDeps: NavigateToWorkspaceDeps = {
    getSessionWorkspaces: (serverId) =>
      serverId === SERVER_ID
        ? new Map(
            [HOST_ID, OWNER_ID, OTHER_ID].map(
              (id) =>
                [
                  id,
                  {
                    id,
                    projectId: id === OTHER_ID ? "project-b" : "project-a",
                  } as WorkspaceDescriptor,
                ] as const,
            ),
          )
        : null,
    getSessionAgents: () => [],
    openTab: (input) => store.getState().openTab(input),
    pinAgent: (key, id) => store.getState().pinAgent(key, id),
    rememberLastWorkspace: (selection) => {
      remembered = selection;
    },
    navigateToRoute: (nextRoute) => {
      route = nextRoute;
    },
  };
  const deps: NavigateToAgentDeps = {
    ...workspaceDeps,
    readAgentNavTarget: () => ({ agentWorkspaceId }),
    navigateToHostAgent: (nextRoute) => {
      route = nextRoute;
    },
    navigateToWorkspace: (input) => navigateToWorkspace(input, workspaceDeps),
  };
  const openAgent = (agentId: string, workspaceId = HOST_ID) =>
    store.getState().openTab({
      workspaceKey: HOST_KEY,
      target: { kind: "agent", agentId, workspaceId },
      intent: "reveal",
    })!;
  const agentIds = (key = HOST_KEY) =>
    store
      .getState()
      .getWorkspaceTabs(key)
      .flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : []));
  return { store, deps, openAgent, agentIds, route: () => route, remembered: () => remembered };
}

function notification(workspaceId = OWNER_ID) {
  return {
    serverId: SERVER_ID,
    workspaceId,
    agentId: AGENT_ID,
    pin: true,
    tabHost: { serverId: SERVER_ID, workspaceId: HOST_ID },
  };
}

describe("resolveNavigateToAgent", () => {
  it.each([HOST_ID, OWNER_ID])(
    "reveals a notification in its existing pane without changing ownership (%s)",
    (ownerId) => {
      const nav = createNavigation(ownerId);
      nav.openAgent("agent-x");
      const targetTabId = nav.openAgent(AGENT_ID, ownerId);
      nav.openAgent("agent-z");
      const targetPaneId = nav.store.getState().splitPane(HOST_KEY, {
        tabId: targetTabId,
        targetPaneId: "main",
        position: "right",
      });
      nav.openAgent("agent-w");
      const panes = () =>
        collectAllPanes(nav.store.getState().layoutByWorkspace[HOST_KEY].root).map((pane) => ({
          id: pane.id,
          tabIds: pane.tabIds,
        }));
      const before = panes();

      const route = resolveNavigateToAgent(notification(ownerId), nav.deps);

      expect(route).toBe(`/h/${SERVER_ID}/workspace/${HOST_ID}`);
      expect(nav.route()).toBe(route);
      expect(panes()).toEqual(before);
      const layout = nav.store.getState().layoutByWorkspace[HOST_KEY];
      expect(layout.focusedPaneId).toBe(targetPaneId);
      expect(findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId).toBe(targetTabId);
      expect(nav.agentIds().filter((id) => id === AGENT_ID)).toEqual([AGENT_ID]);
      expect(nav.remembered()).toEqual(notification().tabHost);
    },
  );

  it("adds a same-project notification without removing any existing tabs", () => {
    const nav = createNavigation();
    nav.openAgent("agent-x");
    nav.openAgent("agent-z");
    resolveNavigateToAgent(notification(), nav.deps);
    resolveNavigateToAgent(notification(), nav.deps);
    expect(nav.agentIds()).toEqual(["agent-x", "agent-z", AGENT_ID]);
    expect(nav.store.getState().layoutByWorkspace).toHaveProperty(HOST_KEY);
    const opened = nav.store
      .getState()
      .getWorkspaceTabs(HOST_KEY)
      .find((tab) => tab.target.kind === "agent" && tab.target.agentId === AGENT_ID);
    expect(opened?.target.workspaceId).toBe(OWNER_ID);
  });

  it("switches project for a notification without polluting the active project's panes", () => {
    const nav = createNavigation(OTHER_ID);
    nav.openAgent("agent-x");
    const before = nav.store.getState().layoutByWorkspace[HOST_KEY];
    resolveNavigateToAgent(notification(OTHER_ID), nav.deps);
    expect(nav.route()).toBe(`/h/${SERVER_ID}/workspace/${OTHER_ID}`);
    expect(nav.agentIds(OTHER_KEY)).toEqual([AGENT_ID]);
    expect(nav.store.getState().layoutByWorkspace[HOST_KEY]).toEqual(before);
  });

  it("preserves draft-only hosts when a same-project notification arrives", () => {
    const nav = createNavigation();
    nav.store.getState().openTab({
      workspaceKey: HOST_KEY,
      target: { kind: "draft", draftId: "draft-1", workspaceId: HOST_ID },
      intent: "reveal",
    });
    resolveNavigateToAgent(notification(), nav.deps);
    expect(nav.route()).toBe(`/h/${SERVER_ID}/workspace/${HOST_ID}`);
    const tabs = nav.store.getState().getWorkspaceTabs(HOST_KEY);
    expect(tabs.find((tab) => tab.target.kind === "draft")?.target).toMatchObject({
      draftId: "draft-1",
      workspaceId: HOST_ID,
    });
    expect(nav.agentIds()).toEqual([AGENT_ID]);
  });

  it("does not host another server's notification", () => {
    const nav = createNavigation();
    nav.openAgent("agent-x");
    resolveNavigateToAgent({ ...notification(), serverId: "server-2" }, nav.deps);
    expect(nav.route()).toBe(`/h/server-2/workspace/${OWNER_ID}?open=agent%3A${AGENT_ID}`);
    expect(nav.agentIds()).toEqual(["agent-x"]);
  });

  it("opens a notification on its owner when there is no tab host", () => {
    const nav = createNavigation();
    resolveNavigateToAgent({ ...notification(), tabHost: null }, nav.deps);
    expect(nav.route()).toBe(`/h/${SERVER_ID}/workspace/${OWNER_ID}`);
    expect(nav.agentIds()).toEqual([AGENT_ID]);
  });

  it("falls back to agent recovery when neither host nor owner is known", () => {
    const nav = createNavigation(null);
    resolveNavigateToAgent({ serverId: SERVER_ID, agentId: AGENT_ID }, nav.deps);
    expect(nav.route()).toBe(`/h/${SERVER_ID}/agent/${AGENT_ID}`);
    expect(nav.store.getState().layoutByWorkspace).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SplitPane, WorkspaceLayout } from "@/stores/workspace-layout-store";
import { groupSidebarAgentDrafts } from "./sidebar-agent-drafts";

const hostWorkspace = {
  workspaceKey: "server-1:workspace-host",
  serverId: "server-1",
  workspaceId: "workspace-host",
  projectViewKey: "project-host",
  projectName: "Host project",
  projectRootPath: "/host",
  workspaceDirectory: "/host",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
} as const;
const targetWorkspace = {
  workspaceKey: "server-1:workspace-target",
  serverId: "server-1",
  workspaceId: "workspace-target",
  projectViewKey: "project-target",
  projectName: "Target project",
  projectRootPath: "/target",
  workspaceDirectory: "/target",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
} as const;
const projects: SidebarProjectEntry[] = [
  {
    viewKey: "project-host",
    projectName: "Host project",
    projectKind: "git",
    iconWorkingDir: "/host",
    hosts: [
      {
        serverId: "server-1",
        projectId: "project-host",
        iconWorkingDir: "/host",
        worktreeSupport: "supported",
      },
    ],
    workspaces: [hostWorkspace],
  },
  {
    viewKey: "project-target",
    projectName: "Target project",
    projectKind: "git",
    iconWorkingDir: "/target",
    hosts: [
      {
        serverId: "server-1",
        projectId: "project-target",
        iconWorkingDir: "/target",
        worktreeSupport: "supported",
      },
    ],
    workspaces: [targetWorkspace],
  },
];
const hostLayout: WorkspaceLayout = {
  focusedPaneId: "main",
  root: {
    kind: "pane",
    pane: {
      id: "main",
      tabIds: ["agent_existing", "tab-draft-new"],
      focusedTabId: "tab-draft-new",
      tabs: [
        {
          tabId: "agent_existing",
          target: { kind: "agent", agentId: "existing" },
          createdAt: 1,
        },
        {
          tabId: "tab-draft-new",
          target: {
            kind: "draft",
            draftId: "draft-new",
            workspaceId: "workspace-target",
          },
          createdAt: 2,
        },
      ],
    } as SplitPane,
  },
};

describe("sidebar agent drafts", () => {
  it("groups a draft under its owning project", () => {
    const grouped = groupSidebarAgentDrafts({
      projects,
      workspaceLayouts: { "server-1:project:project-target": hostLayout },
      activeRouteSelection: {
        serverId: targetWorkspace.serverId,
        workspaceId: targetWorkspace.workspaceId,
      },
    });

    expect(grouped.get("project-host")).toBeUndefined();
    expect(grouped.get("project-target")).toEqual([
      {
        serverId: "server-1",
        workspaceId: "workspace-target",
        tabHostWorkspaceId: "workspace-target",
        draftId: "draft-new",
        tabId: "tab-draft-new",
        selected: true,
      },
    ]);
  });

  it("groups project-scoped drafts by their owner checkout, not the selected checkout", () => {
    const otherCheckout = {
      ...targetWorkspace,
      workspaceKey: "server-1:workspace-other",
      workspaceId: "workspace-other",
    };
    const grouped = groupSidebarAgentDrafts({
      projects: [projects[0]!, { ...projects[1]!, workspaces: [targetWorkspace, otherCheckout] }],
      workspaceLayouts: { "server-1:project:project-target": hostLayout },
      activeRouteSelection: { serverId: "server-1", workspaceId: otherCheckout.workspaceId },
    });

    expect(grouped.get("project-host")).toBeUndefined();
    expect(grouped.get("project-target")).toEqual([
      {
        serverId: "server-1",
        workspaceId: "workspace-target",
        tabHostWorkspaceId: "workspace-other",
        draftId: "draft-new",
        tabId: "tab-draft-new",
        selected: true,
      },
    ]);
  });

  it("does not advertise a draft tab under a different project's layout", () => {
    const grouped = groupSidebarAgentDrafts({
      projects,
      workspaceLayouts: { "server-1:project:project-host": hostLayout },
      activeRouteSelection: {
        serverId: hostWorkspace.serverId,
        workspaceId: hostWorkspace.workspaceId,
      },
    });
    expect(grouped.get("project-target")).toBeUndefined();
    expect(grouped.get("project-host")).toBeUndefined();
  });
});

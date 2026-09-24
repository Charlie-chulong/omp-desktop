import { describe, expect, it } from "vitest";
import {
  resolveAgentTabPrimaryLabel,
  resolveSidebarWorkspaceAccessibilityLabel,
  resolveSidebarWorkspacePrimaryLabel,
} from "@/components/sidebar/sidebar-workspace-title";

describe("resolveSidebarWorkspacePrimaryLabel", () => {
  it("uses the workspace name in title mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search" },
      workspaceTitleSource: "title",
    });

    expect(label).toBe("Investigate search");
  });

  it("uses the branch name in branch mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search" },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("fix/search");
  });

  it("falls back to the workspace name in branch mode without a branch", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Local folder", currentBranch: null },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("Local folder");
  });
});
describe("resolveAgentTabPrimaryLabel", () => {
  it("uses the new conversation label before a primary agent has a workspace label", () => {
    expect(
      resolveAgentTabPrimaryLabel({
        agentTitle: "New Agent",
        isPrimaryAgent: true,
        newConversationLabel: "新建对话",
      }),
    ).toBe("新建对话");
  });

  it("shows the sidebar's current workspace label on the primary tab, not its original prompt", () => {
    const workspace = { name: "分析破解包广告修改", currentBranch: "fix/ads" };
    for (const workspaceTitleSource of ["title", "branch"] as const) {
      const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({
        workspace,
        workspaceTitleSource,
      });
      expect(
        resolveAgentTabPrimaryLabel({
          agentTitle: "帮我使用 jadx 分析",
          isPrimaryAgent: true,
          workspaceLabel,
          newConversationLabel: "新建对话",
        }),
      ).toBe(workspaceLabel);
      expect(
        resolveAgentTabPrimaryLabel({
          agentTitle: "子任务",
          isPrimaryAgent: false,
          workspaceLabel,
          newConversationLabel: "新建对话",
        }),
      ).toBe("子任务");
    }
  });

  it("preserves a named agent's title and does not name an untitled child conversation", () => {
    expect(
      resolveAgentTabPrimaryLabel({
        agentTitle: "Investigate failure",
        isPrimaryAgent: true,
        newConversationLabel: "新建对话",
      }),
    ).toBe("Investigate failure");
    expect(
      resolveAgentTabPrimaryLabel({
        agentTitle: null,
        isPrimaryAgent: false,
        newConversationLabel: "新建对话",
      }),
    ).toBeNull();
  });
});

describe("resolveSidebarWorkspaceAccessibilityLabel", () => {
  it("includes the visible host badge with the workspace title", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", statusBucket: "done" },
      workspaceTitleSource: "title",
      hostBadgeLabel: "Build host",
    });

    expect(label).toBe("Investigate search, Build host");
  });

  it("owns every visual row contributor in one accessible label", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: {
        name: "Investigate search",
        currentBranch: "fix/search",
        statusBucket: "running",
      },
      workspaceTitleSource: "branch",
      leadingProjectName: "Search project",
      hostBadgeLabel: "Build host",
      pullRequestLabel: "Pull request 42",
      serviceLabel: "Service web running",
    });

    expect(label).toBe(
      "Search project, fix/search, Build host, Pull request 42, Service web running, Working",
    );
  });

  it("omits the idle status from the workspace label", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", statusBucket: "done" },
      workspaceTitleSource: "title",
      leadingProjectName: "Search project",
      hostBadgeLabel: "Build host",
    });

    expect(label).toBe("Search project, Investigate search, Build host");
  });
});

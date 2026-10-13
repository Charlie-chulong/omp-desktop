import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { captureWorkspaceTabCleanup, closeWorkspaceAgentTabs } from "./workspace-tab-cleanup";

const projectKey = "host:project:shared";

describe("workspace tab cleanup in a shared project", () => {
  beforeEach(() => {
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  });

  it("removes only deleted checkout tabs, retaining sibling files and terminals", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey: projectKey,
      target: { kind: "file", path: "src/file.ts", workspaceId: "first" },
      intent: "new",
    });
    store.openTab({
      workspaceKey: projectKey,
      target: { kind: "file", path: "src/file.ts", workspaceId: "second" },
      intent: "new",
    });
    store.openTab({
      workspaceKey: projectKey,
      target: { kind: "terminal", terminalId: "second-terminal", workspaceId: "second" },
      intent: "new",
    });
    store.openTab({
      workspaceKey: projectKey,
      target: { kind: "draft", draftId: "first-draft", workspaceId: "first" },
      intent: "new",
    });

    closeWorkspaceAgentTabs(captureWorkspaceTabCleanup({ serverId: "host", workspaceId: "first" }));

    const targets = collectAllTabs(
      useWorkspaceLayoutStore.getState().layoutByWorkspace[projectKey].root,
    )
      .filter((tab) => tab.target.kind !== "new_tab")
      .map((tab) => tab.target);
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "file", workspaceId: "second" }),
        expect.objectContaining({ kind: "terminal", workspaceId: "second" }),
      ]),
    );
    expect(targets.some((target) => target.workspaceId === "first")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  collectAllTabs,
  findBottomTerminalPaneId,
  findPaneContainingTab,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "./model";
import {
  migrateLegacyProjectLayouts,
  resolveProjectLayoutKeyFromWorkspaces,
} from "./project-scope";

function layout(...tabs: WorkspaceTab[]): WorkspaceLayout {
  const pane = {
    id: "main",
    tabs,
    tabIds: tabs.map((tab) => tab.tabId),
    focusedTabId: tabs[0]?.tabId ?? null,
  };
  return { root: { kind: "pane", pane }, focusedPaneId: "main" };
}

const workspaces = new Map([
  [
    "first",
    { id: "first", projectId: "one", workspaceDirectory: "/one/first", projectRootPath: "/one" },
  ],
  [
    "second",
    { id: "second", projectId: "one", workspaceDirectory: "/one/second", projectRootPath: "/one" },
  ],
  [
    "other",
    { id: "other", projectId: "two", workspaceDirectory: "/two/other", projectRootPath: "/two" },
  ],
]);

const tab = (
  tabId: string,
  target: WorkspaceTab["target"],
  state?: WorkspaceTab["state"],
): WorkspaceTab => ({
  tabId,
  target,
  createdAt: 42,
  ...(state === undefined ? {} : { state }),
});

describe("project layout migration", () => {
  it("returns no layout identity until workspace metadata resolves", () => {
    expect(
      resolveProjectLayoutKeyFromWorkspaces({
        serverId: "host",
        workspaceId: "missing",
        workspaces,
      }),
    ).toBeNull();
    expect(
      resolveProjectLayoutKeyFromWorkspaces({
        serverId: "host",
        workspaceId: "second",
        workspaces,
      }),
    ).toBe("host:project:one");
  });

  it("splits mixed panes by actual owners while preserving ids, state, focus and terminal zone", () => {
    const source = layout(
      tab("agent-other", { kind: "agent", agentId: "agent-other" }, { scrollTop: 33 }),
      tab("file-second", { kind: "file", path: "/one/second/src/main.ts" }, { cursor: 17 }),
      tab("terminal-first", { kind: "terminal", terminalId: "term-first", workspaceId: "other" }),
      tab("relative", { kind: "file", path: "src/local.ts" }, { cursor: 11 }),
    );
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": source },
      workspaces,
      agentWorkspaceIds: new Map([["agent-other", "other"]]),
      terminalWorkspaceIds: new Map([["term-first", "first"]]),
    });
    expect(migrated.pending).toEqual([]);
    expect(migrated.layouts["host:first"]).toBeUndefined();
    const other = migrated.layouts["host:project:two"];
    expect(collectAllTabs(other.root).find((item) => item.tabId === "agent-other")).toMatchObject({
      target: { workspaceId: "other" },
      state: { scrollTop: 33 },
    });
    expect(findPaneContainingTab(other.root, "agent-other")?.focusedTabId).toBe("agent-other");
    const project = migrated.layouts["host:project:one"];
    expect(collectAllTabs(project.root).find((item) => item.tabId === "file-second")).toMatchObject(
      {
        target: { workspaceId: "second" },
        state: { cursor: 17 },
      },
    );
    expect(collectAllTabs(other.root).find((item) => item.tabId === "relative")).toMatchObject({
      target: { workspaceId: "other" },
      state: { cursor: 11 },
    });
    expect(
      collectAllTabs(project.root).find((item) => item.tabId === "terminal-first")?.target
        .workspaceId,
    ).toBe("first");
    expect(findPaneContainingTab(project.root, "terminal-first")?.id).toBe(
      findBottomTerminalPaneId({ layout: project, tabs: collectAllTabs(project.root) }),
    );
    const rerun = migrateLegacyProjectLayouts({ ...migrated, serverId: "host", workspaces });
    expect(rerun.layouts).toBe(migrated.layouts);
  });

  it("keeps tools in the side panel when two workspace layouts join the same project", () => {
    const merged = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: {
        "host:first": layout(tab("main-file", { kind: "file", path: "src/one.ts" })),
        "host:second": layout(
          tab("right-tool", { kind: "files" }),
          tab("bottom-terminal", { kind: "terminal", terminalId: "term-two" }),
        ),
      },
      workspaces,
      terminalWorkspaceIds: new Map([["term-two", "second"]]),
    });
    const project = merged.layouts["host:project:one"];
    expect(findPaneContainingTab(project.root, "main-file")?.id).not.toBe(
      findPaneContainingTab(project.root, "right-tool")?.id,
    );
    expect(findPaneContainingTab(project.root, "bottom-terminal")?.id).toBe(
      findBottomTerminalPaneId({ layout: project, tabs: collectAllTabs(project.root) }),
    );
    expect(
      collectAllTabs(project.root).find((item) => item.tabId === "right-tool")?.target.workspaceId,
    ).toBe("second");
  });

  it("keeps ambiguous absolute paths pending when the recorded route is not one of the tied roots", () => {
    const sameRoot = new Map([
      [
        "first",
        {
          id: "first",
          projectId: "one",
          workspaceDirectory: "/shared",
          projectRootPath: "/shared",
        },
      ],
      [
        "second",
        {
          id: "second",
          projectId: "two",
          workspaceDirectory: "/shared",
          projectRootPath: "/shared",
        },
      ],
    ]);
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:unknown": layout(tab("file", { kind: "file", path: "/shared/file.ts" })) },
      workspaces: sameRoot,
    });
    expect(migrated.pending.map(({ tab: item }) => item.tabId)).toEqual(["file"]);
    expect(migrated.layouts["host:project:one"]).toBeUndefined();
    expect(
      collectAllTabs(migrated.layouts["host:unknown"].root)[0]?.target.workspaceId,
    ).toBeUndefined();
  });
  it("retries pending actors and terminals when owner metadata arrives without sticky manual flags", () => {
    const original = layout(
      tab("actor", { kind: "agent", agentId: "a" }, { scrollTop: 91 }),
      tab("terminal", { kind: "terminal", terminalId: "t" }, { scrollTop: 18 }),
    );
    const first = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:missing": original },
      workspaces,
    });
    expect(first.pending.map((entry) => entry.tab.tabId)).toEqual(["actor", "terminal"]);
    expect(first.layouts["host:missing"]).toBe(original);
    const hydrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: first.layouts,
      workspaces,
      agentWorkspaceIds: new Map([["a", "other"]]),
      terminalWorkspaceIds: new Map([["t", "second"]]),
    });
    expect(hydrated.pending).toEqual([]);
    expect(hydrated.layouts["host:missing"]).toBeUndefined();
    expect(collectAllTabs(hydrated.layouts["host:project:two"].root)[0]).toMatchObject({
      tabId: "actor",
      target: { workspaceId: "other" },
      state: { scrollTop: 91 },
    });
    expect(
      collectAllTabs(hydrated.layouts["host:project:one"].root).find(
        (item) => item.tabId === "terminal",
      ),
    ).toMatchObject({
      tabId: "terminal",
      target: { workspaceId: "second" },
      state: { scrollTop: 18 },
    });
  });

  it("prunes confirmed deleted resources only when complete catalogs exclude them", () => {
    const raw = layout(
      tab("dead-agent", { kind: "background_process", agentId: "deleted", processId: "p" }),
      tab("dead-terminal", { kind: "terminal", terminalId: "deleted-terminal" }),
      tab("live-agent", { kind: "agent", agentId: "live" }),
    );
    const incomplete = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": raw },
      workspaces,
      agentsHydrated: true,
      terminalsHydrated: true,
    });
    expect(incomplete.pending.map((entry) => entry.tab.tabId)).toEqual([
      "dead-agent",
      "dead-terminal",
      "live-agent",
    ]);
    const complete = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: incomplete.layouts,
      workspaces,
      agentsHydrated: true,
      terminalsHydrated: true,
      knownAgentIds: new Set(["live"]),
      knownTerminalIds: new Set(),
      agentWorkspaceIds: new Map([["live", "other"]]),
    });
    expect(complete.pending).toEqual([]);
    const entities = Object.values(complete.layouts)
      .flatMap((layout) => collectAllTabs(layout.root))
      .filter((item) => item.target.kind === "agent" || item.target.kind === "terminal");
    expect(entities.map((item) => item.tabId)).toEqual(["live-agent"]);
  });

  it("follows parent chains across source layouts before focused checkout, and routes unbound tools to focus", () => {
    const first = {
      ...layout(tab("parent", { kind: "agent", agentId: "a" })),
      parentTabIdByTabId: { child: "parent" },
    };
    const second = {
      ...layout(
        tab("focused", { kind: "agent", agentId: "b" }),
        tab("child", { kind: "file", path: "src/child.ts" }),
        tab("grandchild", { kind: "file", path: "src/grandchild.ts" }),
        tab("tool", { kind: "files" }),
      ),
      parentTabIdByTabId: { child: "parent", grandchild: "child" },
    };
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": first, "host:second": second },
      workspaces,
      agentWorkspaceIds: new Map([
        ["a", "other"],
        ["b", "second"],
      ]),
    });
    const other = collectAllTabs(migrated.layouts["host:project:two"].root);
    expect(other.find((item) => item.tabId === "child")?.target.workspaceId).toBe("other");
    expect(other.find((item) => item.tabId === "grandchild")?.target.workspaceId).toBe("other");
    const same = collectAllTabs(migrated.layouts["host:project:one"].root);
    expect(same.find((item) => item.tabId === "tool")?.target.workspaceId).toBe("second");
  });

  it("uses recorded focus for relative files and tied absolute roots but not a foreign root", () => {
    const tied = new Map([
      ["first", { id: "first", projectId: "one", workspaceDirectory: "/shared" }],
      ["second", { id: "second", projectId: "two", workspaceDirectory: "/shared" }],
      ["other", { id: "other", projectId: "three", workspaceDirectory: "/other" }],
    ]);
    const source = layout(
      tab("conversation", { kind: "agent", agentId: "a" }),
      tab("relative", { kind: "file", path: "src/file.ts" }),
      tab("absolute", { kind: "file", path: "/shared/file.ts" }),
    );
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:other": source },
      workspaces: tied,
      agentWorkspaceIds: new Map([["a", "second"]]),
    });
    expect(migrated.pending).toEqual([]);
    expect(
      collectAllTabs(migrated.layouts["host:project:two"].root)
        .filter((item) => item.target.kind !== "new_tab")
        .map((item) => item.tabId),
    ).toEqual(["conversation", "relative", "absolute"]);
  });

  it("does not replace modern project tabs or duplicate them on later metadata refresh", () => {
    const modern = layout(
      tab("existing", { kind: "file", path: "current.ts", workspaceId: "second" }, { cursor: 7 }),
    );
    const raw = layout(
      tab("existing", { kind: "file", path: "old.ts" }, { cursor: 1 }),
      tab("new", { kind: "new_tab" }),
    );
    const first = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": raw, "host:project:one": modern },
      workspaces,
    });
    const tabs = collectAllTabs(first.layouts["host:project:one"].root);
    expect(tabs.filter((item) => item.tabId === "existing")).toEqual([
      collectAllTabs(modern.root)[0],
    ]);
    expect(first.pending).toEqual([]);
    expect(first.layouts["host:first"]).toBeUndefined();
    expect(
      tabs.find((item) => item.target.kind === "file" && item.target.path === "old.ts"),
    ).toMatchObject({ target: { workspaceId: "first" }, state: { cursor: 1 } });
    expect(tabs.find((item) => item.tabId === "new")?.target.workspaceId).toBe("first");
    const again = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: first.layouts,
      workspaces,
      agentsHydrated: true,
      knownAgentIds: new Set(),
    });
    expect(again.layouts).toBe(first.layouts);
  });

  it("separates the same old file ID in two checkouts of one project", () => {
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: {
        "host:first": layout(
          tab("file_src/index.ts", { kind: "file", path: "src/index.ts" }, { cursor: 1 }),
        ),
        "host:second": layout(
          tab("file_src/index.ts", { kind: "file", path: "src/index.ts" }, { cursor: 2 }),
        ),
      },
      workspaces,
    });
    expect(migrated.pending).toEqual([]);
    const files = collectAllTabs(migrated.layouts["host:project:one"].root).filter(
      (item) => item.target.kind === "file",
    );
    expect(files.map((item) => ({ owner: item.target.workspaceId, state: item.state }))).toEqual([
      { owner: "first", state: { cursor: 1 } },
      { owner: "second", state: { cursor: 2 } },
    ]);
    expect(new Set(files.map((item) => item.tabId)).size).toBe(2);
  });

  it("deduplicates the same conversation referenced by several old containers", () => {
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: {
        "host:first": layout(tab("agent_a", { kind: "agent", agentId: "a" })),
        "host:second": layout(tab("agent_a", { kind: "agent", agentId: "a" })),
      },
      workspaces,
      agentWorkspaceIds: new Map([["a", "other"]]),
    });
    expect(migrated.pending).toEqual([]);
    expect(migrated.layouts["host:first"]).toBeUndefined();
    expect(migrated.layouts["host:second"]).toBeUndefined();
    expect(
      collectAllTabs(migrated.layouts["host:project:two"].root)
        .filter((item) => item.target.kind === "agent")
        .map((item) => item.target),
    ).toEqual([{ kind: "agent", agentId: "a", workspaceId: "other" }]);
  });
  it("corrects stale bound actor and terminal workspaces while leaving bound resource tools unchanged", () => {
    const source = layout(
      tab("subagent", {
        kind: "provider_subagent",
        parentAgentId: "a",
        subagentId: "sub",
        workspaceId: "first",
      }),
      tab("process", {
        kind: "background_process",
        agentId: "a",
        processId: "p",
        workspaceId: "first",
      }),
      tab("plugin", {
        kind: "plugin",
        pluginId: "x",
        panelId: "p",
        context: "agent",
        agentId: "a",
        workspaceId: "first",
      }),
      tab("terminal", { kind: "terminal", terminalId: "t", workspaceId: "first" }),
      tab("file", { kind: "file", path: "src/file.ts", workspaceId: "first" }),
      tab("draft", { kind: "draft", draftId: "d", workspaceId: "first" }),
    );
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": source },
      workspaces,
      agentWorkspaceIds: new Map([["a", "other"]]),
      terminalWorkspaceIds: new Map([["t", "other"]]),
    });
    expect(migrated.pending).toEqual([]);
    const moved = collectAllTabs(migrated.layouts["host:project:two"].root).filter(
      (item) => item.target.kind !== "new_tab",
    );
    expect(new Set(moved.map((item) => item.tabId))).toEqual(
      new Set(["subagent", "process", "plugin", "terminal"]),
    );
    expect(moved.every((item) => item.target.workspaceId === "other")).toBe(true);
    const retained = collectAllTabs(migrated.layouts["host:project:one"].root).filter(
      (item) => item.target.kind === "file" || item.target.kind === "draft",
    );
    expect(
      retained.map((item) => ({ tabId: item.tabId, workspaceId: item.target.workspaceId })),
    ).toEqual([
      { tabId: "file", workspaceId: "first" },
      { tabId: "draft", workspaceId: "first" },
    ]);
  });

  it("retains children of a pending opener until its real checkout resolves", () => {
    const source = {
      ...layout(
        tab("agent", { kind: "agent", agentId: "unknown" }),
        tab("file", { kind: "file", path: "src/file.ts" }),
        tab("tool", { kind: "files" }),
      ),
      parentTabIdByTabId: { file: "agent" },
    };
    const initial = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": source },
      workspaces,
    });
    expect(initial.pending.map((entry) => entry.tab.tabId)).toEqual(["agent", "file", "tool"]);
    expect(initial.layouts["host:first"]).toBe(source);
    const resolved = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: initial.layouts,
      workspaces,
      agentWorkspaceIds: new Map([["unknown", "other"]]),
    });
    expect(resolved.pending).toEqual([]);
    expect(
      collectAllTabs(resolved.layouts["host:project:two"].root).map((item) => item.tabId),
    ).toEqual(["agent", "file", "tool"]);
  });
  it("uses its recorded source for unbound drafts, new tabs, tools and relative files without an opener", () => {
    const source = layout(
      tab("draft", { kind: "draft", draftId: "d" }),
      tab("new", { kind: "new_tab" }),
      tab("file", { kind: "file", path: "src/file.ts" }),
      tab("tool", { kind: "working_diff" }),
    );
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": source },
      workspaces,
    });
    expect(migrated.pending).toEqual([]);
    expect(
      collectAllTabs(migrated.layouts["host:project:one"].root).map(
        (item) => item.target.workspaceId,
      ),
    ).toEqual(["first", "first", "first", "first"]);
  });
  it("corrects only known entity owners in already-project layouts", () => {
    const original = layout(
      tab("agent", { kind: "agent", agentId: "a", workspaceId: "first" }, { scrollTop: 4 }),
      tab("terminal", { kind: "terminal", terminalId: "t", workspaceId: "first" }),
      tab("bound-file", { kind: "file", path: "src/file.ts", workspaceId: "first" }),
    );
    const updated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:project:one": original },
      workspaces,
      agentWorkspaceIds: new Map([["a", "other"]]),
      terminalWorkspaceIds: new Map([["t", "second"]]),
    });
    expect(updated.pending).toEqual([]);
    expect(collectAllTabs(updated.layouts["host:project:two"].root)[0]).toMatchObject({
      tabId: "agent",
      state: { scrollTop: 4 },
      target: { workspaceId: "other" },
    });
    const same = collectAllTabs(updated.layouts["host:project:one"].root);
    expect(same.find((item) => item.tabId === "terminal")?.target.workspaceId).toBe("second");
    expect(same.find((item) => item.tabId === "bound-file")?.target.workspaceId).toBe("first");
    const again = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: updated.layouts,
      workspaces,
      agentWorkspaceIds: new Map([["a", "other"]]),
      terminalWorkspaceIds: new Map([["t", "second"]]),
    });
    expect(again.layouts).toBe(updated.layouts);
  });
  it("uses a focused main conversation behind an unbound focused tool without guessing its owner", () => {
    const conversation = tab("conversation", { kind: "agent", agentId: "a" });
    const file = tab("file", { kind: "file", path: "src/file.ts" });
    const tool = tab("tool", { kind: "files" });
    const mainPane = {
      id: "main",
      tabs: [conversation, file],
      tabIds: ["conversation", "file"],
      focusedTabId: "conversation",
    };
    const toolPane = { id: "tools", tabs: [tool], tabIds: ["tool"], focusedTabId: "tool" };
    const source: WorkspaceLayout = {
      root: {
        kind: "group",
        group: {
          id: "split",
          direction: "horizontal",
          sizes: [0.7, 0.3],
          children: [
            { kind: "pane", pane: mainPane },
            { kind: "pane", pane: toolPane },
          ],
        },
      },
      focusedPaneId: "tools",
    };
    const before = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": source },
      workspaces,
    });
    expect(before.pending.map((entry) => entry.tab.tabId)).toEqual([
      "conversation",
      "file",
      "tool",
    ]);
    const after = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: before.layouts,
      workspaces,
      agentWorkspaceIds: new Map([["a", "other"]]),
    });
    expect(after.pending).toEqual([]);
    expect(
      collectAllTabs(after.layouts["host:project:two"].root).map((item) => item.target.workspaceId),
    ).toEqual(["other", "other", "other"]);
  });
  it("keeps a pending tab's recorded opener link after the opener migrates", () => {
    const shared = new Map([
      ["first", { id: "first", projectId: "one", workspaceDirectory: "/shared" }],
      ["second", { id: "second", projectId: "two", workspaceDirectory: "/shared" }],
      ["other", { id: "other", projectId: "three", workspaceDirectory: "/other" }],
    ]);
    const source = {
      ...layout(
        tab("opener", { kind: "agent", agentId: "a", workspaceId: "other" }),
        tab("ambiguous", { kind: "file", path: "/shared/file.ts" }),
      ),
      parentTabIdByTabId: { ambiguous: "opener" },
    };
    const migrated = migrateLegacyProjectLayouts({
      serverId: "host",
      layouts: { "host:first": source },
      workspaces: shared,
    });
    expect(migrated.pending.map((entry) => entry.tab.tabId)).toEqual(["ambiguous"]);
    expect(migrated.layouts["host:first"].parentTabIdByTabId).toEqual({ ambiguous: "opener" });
    expect(collectAllTabs(migrated.layouts["host:project:three"].root)[0]?.tabId).toBe("opener");
  });
});

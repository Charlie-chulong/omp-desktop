import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarWorkspaceMenu } from "./sidebar-workspace-menu";

type ItemProps = React.PropsWithChildren<{
  testID?: string;
  onSelect?: () => void;
  status?: string;
}>;
const state = vi.hoisted(() => ({
  items: new Map<string, { onSelect?: () => void; status?: string }>(),
  folderPath: undefined as string | null | undefined,
  trigger: undefined as
    | {
        accessibilityRole?: string;
        accessibilityLabel?: string;
        onPressIn?: (event: { stopPropagation: () => void }) => void;
        onPointerDown?: (event: { stopPropagation: () => void }) => void;
      }
    | undefined,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => children,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => children,
  DropdownMenuTrigger: (props: {
    accessibilityRole?: string;
    accessibilityLabel?: string;
    onPressIn?: (event: { stopPropagation: () => void }) => void;
    onPointerDown?: (event: { stopPropagation: () => void }) => void;
  }) => {
    state.trigger = props;
    return null;
  },
  DropdownMenuItem: ({ testID, onSelect, status }: ItemProps) => {
    if (testID) state.items.set(testID, { onSelect, status });
    return null;
  },
  DropdownMenuSubTrigger: () => null,
}));
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: () => null,
  ContextMenuContent: () => null,
  ContextMenuTrigger: () => null,
  ContextMenuItem: () => null,
}));
vi.mock("@/components/ui/shortcut", () => ({ Shortcut: () => null }));
vi.mock("@/workspace/open-in-file-manager/menu-item", () => ({
  OpenInFileManagerMenuItem: ({ path }: { path?: string | null }) => {
    state.folderPath = path;
    return null;
  },
}));
vi.mock("@/components/sidebar/workspace-meta-row", () => ({ workspaceServiceLabelKey: vi.fn() }));
vi.mock("@/workspace-labels/picker", () => ({
  useWorkspaceLabelMenuPages: () => [],
  WORKSPACE_LABEL_PAGE_ID: "labels",
}));
vi.mock("@/components/sidebar/workspace-conversations-menu", () => ({
  useWorkspaceConversationMenuPages: () => [],
  WORKSPACE_CONVERSATIONS_PAGE_ID: "conversations",
}));

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.items.clear();
  state.trigger = undefined;
  state.folderPath = undefined;
});

describe("workspace explicit menu parity", () => {
  it("exposes reference, fork, and open-folder actions without requiring hover or right-click", () => {
    const reference = vi.fn();
    const fork = vi.fn();
    renderToStaticMarkup(
      <SidebarWorkspaceMenu
        workspaceKey="host:workspace"
        onArchive={vi.fn()}
        onReferenceContent={reference}
        referenceContentStatus="pending"
        onFork={fork}
        forkPending
        openInFileManagerPath="/repo/workspace"
      />,
    );
    const referenceItem = state.items.get(
      "sidebar-workspace-menu-reference-content-host:workspace",
    );
    const forkItem = state.items.get("sidebar-workspace-menu-fork-host:workspace");
    expect(referenceItem?.status).toBe("pending");
    expect(forkItem?.status).toBe("pending");
    referenceItem?.onSelect?.();
    forkItem?.onSelect?.();
    expect(reference).toHaveBeenCalledOnce();
    expect(fork).toHaveBeenCalledOnce();
    expect(state.folderPath).toBe("/repo/workspace");
    expect(state.trigger?.accessibilityRole).toBe("button");
    expect(state.trigger?.accessibilityLabel).toBe("sidebar.workspace.actions.menu");
    const stopPropagation = vi.fn();
    state.trigger?.onPressIn?.({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("omits reference and fork when their feature-gated callbacks are unavailable", () => {
    renderToStaticMarkup(
      <SidebarWorkspaceMenu workspaceKey="host:workspace" onArchive={vi.fn()} />,
    );
    expect(state.items.has("sidebar-workspace-menu-reference-content-host:workspace")).toBe(false);
    expect(state.items.has("sidebar-workspace-menu-fork-host:workspace")).toBe(false);
    expect(state.items.has("sidebar-workspace-menu-archive-host:workspace")).toBe(true);
  });
});

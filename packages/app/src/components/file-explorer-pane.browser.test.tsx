import React, { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentFileExplorerState,
  ExplorerDirectory,
  ExplorerEntry,
} from "@/stores/session-store";
import { buildWorkspaceExplorerStateKey } from "@/file-explorer/state-key";
import { EXPLORER_ENTRY_DRAG_MIME } from "@/file-explorer/entry-drag";
import { WORKSPACE_FILE_DRAG_MIME } from "@/attachments/workspace-file-drag";
import { MenuRoot } from "@/components/ui/menu/menu-root";
import { useMenuContext } from "@/components/ui/menu/menu-context";
import { FileExplorerPane } from "./file-explorer-pane";

const fixture = vi.hoisted(() => ({
  directories: new Map<string, ExplorerDirectory>(),
  sessions: {} as Record<
    string,
    {
      fileExplorer: Map<string, AgentFileExplorerState>;
      serverInfo: { features: { fsEntryMove: boolean } };
    }
  >,
  expandedPathsByWorkspace: {} as Record<string, string[]>,
  requestDirectoryListing: vi.fn<(path: string) => Promise<ExplorerDirectory | null>>(),
  moveEntry: vi.fn<
    (input: { path: string; parentPath: string }) => Promise<{
      success: boolean;
      movedPath: string;
    }>
  >(),
  selectExplorerEntry: vi.fn(),
  setExpandedPathsForWorkspace: vi.fn(),
  setExplorerSortOption: vi.fn(),
  toggleExplorerShowHiddenFiles: vi.fn(),
  download: vi.fn(),
  toastError: vi.fn(),
}));

// Keep the pane, row controls, context trigger, RN web DOM, and drag hook real.
// Replace daemon/persistence boundaries and unrelated search/menu presentation.
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: { sessions: typeof fixture.sessions }) => unknown) =>
    selector({ sessions: fixture.sessions }),
}));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (
    selector: (state: {
      explorerSortOption: "name";
      explorerShowHiddenFiles: boolean;
      expandedPathsByWorkspace: typeof fixture.expandedPathsByWorkspace;
      explorerRevealRequest: null;
      setExplorerSortOption: typeof fixture.setExplorerSortOption;
      toggleExplorerShowHiddenFiles: typeof fixture.toggleExplorerShowHiddenFiles;
      setExpandedPathsForWorkspace: typeof fixture.setExpandedPathsForWorkspace;
    }) => unknown,
  ) =>
    selector({
      explorerSortOption: "name",
      explorerShowHiddenFiles: true,
      expandedPathsByWorkspace: fixture.expandedPathsByWorkspace,
      explorerRevealRequest: null,
      setExplorerSortOption: fixture.setExplorerSortOption,
      toggleExplorerShowHiddenFiles: fixture.toggleExplorerShowHiddenFiles,
      setExpandedPathsForWorkspace: fixture.setExpandedPathsForWorkspace,
    }),
}));
vi.mock("@/hooks/use-file-explorer-actions", () => ({
  useFileExplorerActions: () => ({
    requestDirectoryListing: fixture.requestDirectoryListing,
    moveEntry: fixture.moveEntry,
    selectExplorerEntry: fixture.selectExplorerEntry,
  }),
}));
vi.mock("@/hooks/use-file-download", () => ({ useFileDownload: () => fixture.download }));
vi.mock("@/hooks/use-is-local-daemon", () => ({ useIsLocalDaemon: () => false }));
vi.mock("@/hooks/use-fine-pointer", () => ({ useShowPersistentActions: () => true }));
vi.mock("@/workspace/desktop-open-targets", () => ({
  useDesktopOpenTargets: () => ({ targets: [] }),
  openDesktopTarget: vi.fn(),
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: fixture.toastError }),
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("@/components/file-explorer-search", () => ({ FileExplorerSearch: () => null }));
vi.mock("@/components/file-explorer-content-search", () => ({
  FileExplorerContentSearch: () => null,
}));
vi.mock("@/components/ui/overlay-scrollbar/use-overlay-flat-list-scrollbar", () => ({
  useOverlayFlatListScrollbar: () => ({ enabled: false, overlay: null }),
}));
vi.mock("@/components/ui/menu", () => ({
  MenuRoot: (props: ComponentProps<typeof MenuRoot>) => <MenuRoot {...props} />,
  useMenuContext: (componentName: string) => useMenuContext(componentName),
  MenuSurface: () => null,
  MenuItem: () => null,
  MenuLabel: () => null,
  MenuHint: () => null,
  MenuSeparator: () => null,
}));

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function entry(path: string, kind: ExplorerEntry["kind"]): ExplorerEntry {
  return { path, name: path.split("/").at(-1)!, kind, size: 0, modifiedAt: "2026-10-01T00:00:00Z" };
}

function requireElement(testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing ${testId}`);
  return element;
}

function row(name: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-testid^="file-explorer-row-"][aria-label="${name}"]`,
  );
  if (!element) throw new Error(`Missing row ${name}`);
  return element;
}

function siblingAction(name: string, action: "more" | "select" | "move-here"): HTMLElement {
  return requireElement(`${row(name).dataset.testid}-${action}`);
}

function startDrag(): DataTransfer {
  const transfer = new DataTransfer();
  act(() => {
    row("source.ts").dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }),
    );
  });
  return transfer;
}

function dispatchDrag(
  target: HTMLElement,
  type: "dragover" | "drop",
  transfer: DataTransfer,
): DragEvent {
  const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.directories.clear();
  fixture.directories.set(".", {
    path: ".",
    entries: [entry("archive", "directory"), entry("src", "directory"), entry("root.txt", "file")],
  });
  fixture.directories.set("src", {
    path: "src",
    entries: [entry("src/source.ts", "file"), entry("src/other.ts", "file")],
  });
  fixture.directories.set("archive", { path: "archive", entries: [] });
  const stateKey = buildWorkspaceExplorerStateKey({
    workspaceId: "workspace-1",
    workspaceRoot: "/workspace",
  })!;
  fixture.sessions = {
    "server-1": {
      serverInfo: { features: { fsEntryMove: true } },
      fileExplorer: new Map([
        [
          stateKey,
          {
            directories: fixture.directories,
            files: new Map(),
            refreshRevision: 0,
            isLoading: false,
            lastError: null,
            pendingRequest: null,
            currentPath: ".",
            history: [],
            lastVisitedPath: ".",
            selectedEntryPath: null,
          },
        ],
      ]),
    },
  };
  fixture.expandedPathsByWorkspace = { [stateKey]: [".", "src"] };
  fixture.requestDirectoryListing.mockImplementation(
    async (path) => fixture.directories.get(path) ?? null,
  );
  fixture.moveEntry.mockImplementation(async ({ path, parentPath }) => ({
    success: true,
    movedPath:
      parentPath === "." ? path.split("/").at(-1)! : `${parentPath}/${path.split("/").at(-1)}`,
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  container.style.cssText = "display:flex;width:700px;height:600px";
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <FileExplorerPane
          serverId="server-1"
          workspaceId="workspace-1"
          workspaceRoot="/workspace"
        />
      </QueryClientProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  await queryClient.cancelQueries();
  queryClient.clear();
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("file explorer row drop ownership", () => {
  it("rejects root moves on directory and nested-file gutters and sibling menus", () => {
    const transfer = startDrag();
    for (const name of ["archive", "other.ts"]) {
      // The outer row itself is the hit target over its indentation/padding.
      const gutter = row(name).parentElement!;
      for (const target of [gutter, siblingAction(name, "more")]) {
        expect(dispatchDrag(target, "dragover", transfer).defaultPrevented).toBe(false);
        expect(dispatchDrag(target, "drop", transfer).defaultPrevented).toBe(false);
      }
    }
    expect(fixture.moveEntry).not.toHaveBeenCalled();
  });

  it("rejects root moves on row checkboxes and the sibling move-here action", async () => {
    await act(async () => {
      await userEvent.click(requireElement("files-toggle-selection"));
    });
    const transfer = startDrag();
    for (const name of ["archive", "other.ts"]) {
      const checkbox = siblingAction(name, "select");
      expect(dispatchDrag(checkbox, "dragover", transfer).defaultPrevented).toBe(false);
      expect(dispatchDrag(checkbox, "drop", transfer).defaultPrevented).toBe(false);
    }
    await act(async () => {
      await userEvent.click(siblingAction("source.ts", "select"));
      await userEvent.click(requireElement("files-move-selection"));
    });
    const moveHere = siblingAction("archive", "move-here");
    expect(dispatchDrag(moveHere, "dragover", transfer).defaultPrevented).toBe(false);
    expect(dispatchDrag(moveHere, "drop", transfer).defaultPrevented).toBe(false);
    expect(fixture.moveEntry).not.toHaveBeenCalled();
  });

  it.each([
    { target: "archive", parentPath: "archive" },
    { target: "root.txt", parentPath: "." },
  ])("still moves a source onto the $target label", async ({ target, parentPath }) => {
    const transfer = startDrag();
    expect(Array.from(transfer.types)).toEqual(
      expect.arrayContaining([EXPLORER_ENTRY_DRAG_MIME, WORKSPACE_FILE_DRAG_MIME]),
    );
    expect(dispatchDrag(row(target), "dragover", transfer).defaultPrevented).toBe(true);
    await act(async () => {
      dispatchDrag(row(target), "drop", transfer);
    });
    expect(fixture.moveEntry).toHaveBeenCalledExactlyOnceWith({
      path: "src/source.ts",
      parentPath,
    });
  });

  it("keeps source drag and context selection on the main trigger only", () => {
    const source = row("source.ts");
    expect(source.draggable).toBe(true);
    const gutterTransfer = new DataTransfer();
    act(() => {
      source.parentElement!.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: gutterTransfer }),
      );
    });
    expect(Array.from(gutterTransfer.types)).toEqual([]);
    act(() => {
      source.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
      );
    });
    expect(row("source.ts").getAttribute("aria-selected")).toBe("true");
    expect(Array.from(startDrag().types)).toContain(EXPLORER_ENTRY_DRAG_MIME);
  });
});

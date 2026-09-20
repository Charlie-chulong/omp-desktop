import { describe, expect, it } from "vitest";
import {
  parseExplorerEntryDragPayload,
  resolveExplorerDragEntries,
  resolveExplorerEntryMoves,
  serializeExplorerEntryDragPayload,
  type ExplorerEntryDragPayload,
} from "./entry-drag";

function payload(overrides: Partial<ExplorerEntryDragPayload> = {}): ExplorerEntryDragPayload {
  return {
    version: 1,
    serverId: "server-1",
    workspaceId: "workspace-1",
    entries: [{ path: "src/app.ts", kind: "file" }],
    ...overrides,
  };
}

describe("explorer entry drag", () => {
  it("round-trips the source workspace and entries", () => {
    const dragged = payload({
      entries: [
        { path: "src/app.ts", kind: "file" },
        { path: "src/main.ts", kind: "file" },
      ],
    });
    expect(parseExplorerEntryDragPayload(serializeExplorerEntryDragPayload(dragged))).toEqual(
      dragged,
    );
    expect(parseExplorerEntryDragPayload("not json")).toBeNull();
    expect(
      parseExplorerEntryDragPayload(
        JSON.stringify({
          version: 1,
          serverId: "server-1",
          workspaceId: "workspace-1",
          path: "src/app.ts",
          kind: "file",
        }),
      ),
    ).toBeNull();
  });

  it("drags the whole selection when the grabbed entry is selected", () => {
    expect(
      resolveExplorerDragEntries({
        dragged: { path: "src/main.ts", kind: "file" },
        selectedEntries: [
          { path: "README.md", kind: "file" },
          { path: "src/main.ts", kind: "file" },
          { path: "src/app.ts", kind: "file" },
        ],
      }),
    ).toEqual([
      { path: "src/main.ts", kind: "file" },
      { path: "README.md", kind: "file" },
      { path: "src/app.ts", kind: "file" },
    ]);
  });

  it("drags only the grabbed entry when it is outside the selection", () => {
    expect(
      resolveExplorerDragEntries({
        dragged: { path: "orphan.ts", kind: "file" },
        selectedEntries: [
          { path: "README.md", kind: "file" },
          { path: "src/app.ts", kind: "file" },
        ],
      }),
    ).toEqual([{ path: "orphan.ts", kind: "file" }]);
  });

  it("resolves moves for every independent entry in the same workspace", () => {
    const dragged = payload({
      entries: [
        { path: "src/app.ts", kind: "file" },
        { path: "src/main.ts", kind: "file" },
        { path: "src/nested", kind: "directory" },
        { path: "src/nested/child.ts", kind: "file" },
      ],
    });
    expect(
      resolveExplorerEntryMoves({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-1",
        parentPath: "archive",
      }),
    ).toEqual([
      { path: "src/app.ts", parentPath: "archive", kind: "file" },
      { path: "src/main.ts", parentPath: "archive", kind: "file" },
      { path: "src/nested", parentPath: "archive", kind: "directory" },
    ]);
    expect(
      resolveExplorerEntryMoves({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-1",
        parentPath: "src",
      }),
    ).toBeNull();
    expect(
      resolveExplorerEntryMoves({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-2",
        parentPath: "archive",
      }),
    ).toBeNull();
  });

  it("skips folders that would move into themselves while still moving the rest", () => {
    expect(
      resolveExplorerEntryMoves({
        payload: payload({
          entries: [
            { path: "src/components", kind: "directory" },
            { path: "README.md", kind: "file" },
          ],
        }),
        serverId: "server-1",
        workspaceId: "workspace-1",
        parentPath: "src/components",
      }),
    ).toEqual([{ path: "README.md", parentPath: "src/components", kind: "file" }]);
  });

  it("rejects moving a folder into itself or a descendant when that is the only payload", () => {
    const dragged = payload({
      entries: [{ path: "src/components", kind: "directory" }],
    });
    for (const parentPath of ["src/components", "src/components/nested"]) {
      expect(
        resolveExplorerEntryMoves({
          payload: dragged,
          serverId: "server-1",
          workspaceId: "workspace-1",
          parentPath,
        }),
      ).toBeNull();
    }
  });
});

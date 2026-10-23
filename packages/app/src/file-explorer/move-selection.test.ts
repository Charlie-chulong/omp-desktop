import { describe, expect, it, vi } from "vitest";
import { resolveExplorerEntryMoves, type ExplorerEntryDragItem } from "./entry-drag";
import { moveExplorerSelection } from "./move-selection";
import { resolveExplorerSelection } from "./selection";

function movesTo(entries: ExplorerEntryDragItem[], parentPath: string) {
  return resolveExplorerEntryMoves({
    payload: { version: 1, serverId: "server", workspaceId: "workspace", entries },
    serverId: "server",
    workspaceId: "workspace",
    parentPath,
  });
}

describe("explicit explorer selection moves", () => {
  it("moves a modifier-free multi-selection into a folder, collapsing selected descendants", async () => {
    const entries: ExplorerEntryDragItem[] = [
      { path: "src", kind: "directory" },
      { path: "src/child.txt", kind: "file" },
      { path: "notes.txt", kind: "file" },
    ];
    let selectedPaths = new Set<string>();
    for (const entry of entries) {
      selectedPaths = resolveExplorerSelection({
        path: entry.path,
        selectedPaths,
        visiblePaths: entries.map((item) => item.path),
        anchorPath: null,
        additive: true,
        range: false,
      }).selectedPaths;
    }
    expect([...selectedPaths]).toEqual(["src", "src/child.txt", "notes.txt"]);
    const requests = movesTo(
      entries.filter((entry) => selectedPaths.has(entry.path)),
      "archive",
    );
    expect(requests).toEqual([
      { path: "src", kind: "directory", parentPath: "archive" },
      { path: "notes.txt", kind: "file", parentPath: "archive" },
    ]);
    const reconcile = vi.fn(async () => {});
    const result = await moveExplorerSelection(
      requests!,
      async ({ path }) => ({ success: true, movedPath: `archive/${path}` }),
      reconcile,
    );
    expect(result).toEqual({ movedPaths: ["src", "notes.txt"], failed: false, firstError: null });
    expect(reconcile.mock.calls).toEqual([
      [requests![0], "archive/src"],
      [requests![1], "archive/notes.txt"],
    ]);
  });

  it("supports the workspace root and rejects self, descendant and same-parent destinations", () => {
    expect(movesTo([{ path: "src/a.txt", kind: "file" }], ".")).toEqual([
      { path: "src/a.txt", kind: "file", parentPath: "." },
    ]);
    expect(movesTo([{ path: "src", kind: "directory" }], "src")).toBeNull();
    expect(movesTo([{ path: "src", kind: "directory" }], "src/child")).toBeNull();
    expect(movesTo([{ path: "src/a.txt", kind: "file" }], "src")).toBeNull();
  });

  it("retains failed sources and reconciles only confirmed successes after partial failure", async () => {
    const requests = movesTo(
      [
        { path: "locked.txt", kind: "file" },
        { path: "good.txt", kind: "file" },
        { path: "offline.txt", kind: "file" },
      ],
      "archive",
    )!;
    const reconcile = vi.fn(async () => {});
    const result = await moveExplorerSelection(
      requests,
      async ({ path }) => {
        if (path === "locked.txt") return { success: false, error: "Permission denied" };
        if (path === "offline.txt") throw new Error("Disconnected");
        return { success: true, movedPath: "archive/good.txt" };
      },
      reconcile,
    );
    expect(result).toEqual({
      movedPaths: ["good.txt"],
      failed: true,
      firstError: "Permission denied",
    });
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(requests[1], "archive/good.txt");
    expect(
      requests
        .filter((request) => !result.movedPaths.includes(request.path))
        .map((item) => item.path),
    ).toEqual(["locked.txt", "offline.txt"]);
  });

  it("reports unavailable or malformed outcomes instead of pretending that a move succeeded", async () => {
    const requests = movesTo(
      [
        { path: "a.txt", kind: "file" },
        { path: "b.txt", kind: "file" },
      ],
      "archive",
    )!;
    const move = vi.fn(async ({ path }: { path: string; parentPath: string }) =>
      path === "a.txt" ? null : { success: true },
    );
    const reconcile = vi.fn(async () => {});
    expect(await moveExplorerSelection(requests, move, reconcile)).toEqual({
      movedPaths: [],
      failed: true,
      firstError: null,
    });
    expect(move).toHaveBeenCalledTimes(2);
    expect(reconcile).not.toHaveBeenCalled();
  });
});

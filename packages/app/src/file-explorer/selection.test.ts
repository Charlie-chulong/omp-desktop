import { describe, expect, it } from "vitest";
import {
  collapseExplorerDeletionPaths,
  deleteExplorerSelectionPaths,
  resolveExplorerSelection,
} from "./selection";

const visiblePaths = ["a", "b", "c", "d"];

describe("resolveExplorerSelection", () => {
  it("toggles individual entries without discarding the existing selection", () => {
    const added = resolveExplorerSelection({
      path: "c",
      visiblePaths,
      selectedPaths: new Set(["a"]),
      anchorPath: "a",
      additive: true,
      range: false,
    });
    expect([...added.selectedPaths]).toEqual(["a", "c"]);
    expect(added.activePath).toBe("c");

    const removed = resolveExplorerSelection({
      path: "c",
      visiblePaths,
      selectedPaths: added.selectedPaths,
      anchorPath: added.anchorPath,
      additive: true,
      range: false,
    });
    expect([...removed.selectedPaths]).toEqual(["a"]);
    expect(removed.activePath).toBe("a");
  });

  it("selects the visible range from the stable anchor in either direction", () => {
    const forward = resolveExplorerSelection({
      path: "d",
      visiblePaths,
      selectedPaths: new Set(["b"]),
      anchorPath: "b",
      additive: false,
      range: true,
    });
    expect([...forward.selectedPaths]).toEqual(["b", "c", "d"]);
    expect(forward.anchorPath).toBe("b");

    const backward = resolveExplorerSelection({
      path: "a",
      visiblePaths,
      selectedPaths: forward.selectedPaths,
      anchorPath: forward.anchorPath,
      additive: false,
      range: true,
    });
    expect([...backward.selectedPaths]).toEqual(["a", "b"]);
  });

  it("adds a range to existing entries when the additive modifier is also held", () => {
    const result = resolveExplorerSelection({
      path: "d",
      visiblePaths,
      selectedPaths: new Set(["a", "b"]),
      anchorPath: "c",
      additive: true,
      range: true,
    });
    expect([...result.selectedPaths]).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to a single selection when the anchor is no longer visible", () => {
    const result = resolveExplorerSelection({
      path: "c",
      visiblePaths,
      selectedPaths: new Set(["a"]),
      anchorPath: "hidden",
      additive: false,
      range: true,
    });
    expect([...result.selectedPaths]).toEqual(["c"]);
    expect(result.anchorPath).toBe("c");
  });
});

describe("collapseExplorerDeletionPaths", () => {
  it("deletes every independent selection while collapsing descendants of selected folders", () => {
    expect(
      collapseExplorerDeletionPaths([
        "packages/app",
        "README.md",
        "packages/app/src/index.ts",
        "package.json",
        "README.md",
      ]),
    ).toEqual(["packages/app", "README.md", "package.json"]);
  });
});

describe("deleteExplorerSelectionPaths", () => {
  it("attempts every independent selected path and reports partial failures", async () => {
    const attemptedPaths: string[] = [];
    const result = await deleteExplorerSelectionPaths(
      ["folder", "folder/child.txt", "first.txt", "second.txt"],
      async (path) => {
        attemptedPaths.push(path);
        return path === "first.txt" ? { success: false, error: "locked" } : { success: true };
      },
    );

    expect(attemptedPaths).toEqual(["folder", "first.txt", "second.txt"]);
    expect(result).toEqual({
      deletedPaths: ["folder", "second.txt"],
      failed: true,
      firstError: "locked",
    });
  });
});

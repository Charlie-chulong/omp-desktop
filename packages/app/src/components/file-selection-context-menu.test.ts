import { describe, expect, it } from "vitest";
import { formatFileSelectionReference, getFileSelectionRange } from "./file-selection-context-menu";

describe("file selection references", () => {
  it("formats absolute and workspace-relative line references", () => {
    const selection = { startLine: 12, endLine: 24 };
    expect(
      formatFileSelectionReference({
        path: "packages/app/src/utils/workspace-archive-navigation.test.ts",
        workspaceRoot: "/workspace/project",
        selection,
        absolute: true,
      }),
    ).toBe(
      "@/workspace/project/packages/app/src/utils/workspace-archive-navigation.test.ts#L12-24",
    );
    expect(
      formatFileSelectionReference({
        path: "packages/app/src/utils/workspace-archive-navigation.test.ts",
        workspaceRoot: "/workspace/project",
        selection,
        absolute: false,
      }),
    ).toBe("packages/app/src/utils/workspace-archive-navigation.test.ts#L12-24");
  });

  it("returns the inclusive lines touched by a reverse or forward selection", () => {
    const lineAt = (position: number) => {
      if (position < 10) return { number: 1, from: 0 };
      if (position < 20) return { number: 2, from: 10 };
      return { number: 3, from: 20 };
    };
    expect(getFileSelectionRange({ from: 23, to: 4, lineAt })).toEqual({
      startLine: 1,
      endLine: 3,
    });
    expect(getFileSelectionRange({ from: 4, to: 11, lineAt })).toEqual({
      startLine: 1,
      endLine: 2,
    });
  });
});

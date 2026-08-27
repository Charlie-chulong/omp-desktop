import { describe, expect, it, vi } from "vitest";
import { createDroppedItems } from "./desktop-dropped-items";

describe("desktop dropped items", () => {
  it("turns a dropped directory into a direct path item while preserving regular files", () => {
    const directory = new File([], "project");
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    const getPathForFile = vi.fn((item: File) => `/Users/alice/${item.name}`);

    const items = createDroppedItems({
      files: [directory, file],
      transferItems: [
        { webkitGetAsEntry: () => ({ isDirectory: true }) },
        { webkitGetAsEntry: () => ({ isDirectory: false }) },
      ],
      getPathForFile,
    });

    expect(items).toEqual([
      { kind: "directory-path", path: "/Users/alice/project" },
      { kind: "web-file", file },
    ]);
    expect(getPathForFile).toHaveBeenCalledOnce();
    expect(getPathForFile).toHaveBeenCalledWith(directory);
  });

  it("falls back to a web file when no desktop path bridge is available", () => {
    const directory = new File([], "project");

    expect(
      createDroppedItems({
        files: [directory],
        transferItems: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
      }),
    ).toEqual([{ kind: "web-file", file: directory }]);
  });
});

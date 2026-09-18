import { describe, expect, it } from "vitest";
import { droppedDirectoryPaths } from "./sidebar-project-drop";

const file = new File(["notes"], "notes.txt", { type: "text/plain" });

describe("sidebar project drop", () => {
  it("keeps unique directories and rejects regular files", () => {
    expect(
      droppedDirectoryPaths([
        { kind: "web-file", file },
        { kind: "directory-path", path: "/Users/alice/project" },
        { kind: "directory-path", path: "/Users/alice/project" },
        { kind: "directory-path", path: "/Users/alice/other" },
      ]),
    ).toEqual(["/Users/alice/project", "/Users/alice/other"]);
  });
});

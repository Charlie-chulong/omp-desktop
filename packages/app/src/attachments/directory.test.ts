import { describe, expect, it } from "vitest";
import {
  appendDirectoryAttachment,
  createDirectoryComposerAttachment,
  directoryAttachmentToAgentAttachment,
  getDirectoryName,
} from "./directory";

describe("directory composer attachments", () => {
  it("keeps the selected absolute path without reading directory contents", () => {
    const attachment = createDirectoryComposerAttachment(" /Users/alice/My Project/ ");

    expect(attachment).toEqual({ kind: "directory", path: "/Users/alice/My Project" });
    expect(directoryAttachmentToAgentAttachment(attachment)).toEqual({
      type: "text",
      mimeType: "text/plain",
      contextKind: "directory",
      title: "My Project",
      text: "Directory: /Users/alice/My Project",
    });
  });

  it("extracts directory names from Windows paths", () => {
    expect(getDirectoryName("C:\\Users\\alice\\My Project\\")).toBe("My Project");
  });

  it("does not add the same directory twice", () => {
    const first = createDirectoryComposerAttachment("C:\\Users\\alice\\Project\\");
    const second = createDirectoryComposerAttachment("c:/users/alice/project");

    expect(appendDirectoryAttachment([first], second)).toEqual([first]);
  });
});

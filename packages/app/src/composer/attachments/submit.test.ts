import { describe, expect, it } from "vitest";
import { createDirectoryComposerAttachment } from "@/attachments/directory";
import { splitComposerAttachmentsForSubmit } from "./submit";

describe("composer attachment submission", () => {
  it("submits a directory as a direct text reference without an upload attachment", () => {
    const result = splitComposerAttachmentsForSubmit([
      createDirectoryComposerAttachment("/Users/alice/My Project"),
    ]);

    expect(result.images).toEqual([]);
    expect(result.attachments).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "directory",
        title: "My Project",
        text: "Directory: /Users/alice/My Project",
      },
    ]);
  });
  it("submits quoted content as a direct text attachment", () => {
    const result = splitComposerAttachmentsForSubmit([
      { kind: "quoted_content", id: "quote-1", text: "The selected response." },
    ]);

    expect(result.images).toEqual([]);
    expect(result.attachments).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "Quoted content",
        text: "The selected response.",
      },
    ]);
  });
});

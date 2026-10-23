import { describe, expect, it } from "vitest";
import { createWorkspaceFileAttachment } from "./workspace-file";
import { createDirectoryComposerAttachment } from "./directory";
import {
  parseWorkspaceFileDragPayload,
  resolveWorkspaceFileDrop,
  serializeWorkspaceFileDragPayload,
  type WorkspaceFileDragPayload,
} from "./workspace-file-drag";

function payload(): WorkspaceFileDragPayload {
  return {
    version: 1,
    serverId: "server-1",
    workspaceId: "workspace-1",
    attachment: createWorkspaceFileAttachment({
      path: "src/app.ts",
      selection: { kind: "line_range", startLine: 12, endLine: 24 },
    }),
  };
}

describe("workspace file drag payload", () => {
  it("round-trips workspace identity and future line selections", () => {
    expect(parseWorkspaceFileDragPayload(serializeWorkspaceFileDragPayload(payload()))).toEqual(
      payload(),
    );
  });

  it("accepts directory references and rejects empty directory paths", () => {
    const dragged: WorkspaceFileDragPayload = {
      ...payload(),
      attachment: createDirectoryComposerAttachment("/workspace/src"),
    };
    expect(parseWorkspaceFileDragPayload(serializeWorkspaceFileDragPayload(dragged))).toEqual(
      dragged,
    );
    expect(
      parseWorkspaceFileDragPayload(
        JSON.stringify({ ...dragged, attachment: { kind: "directory", path: " " } }),
      ),
    ).toBeNull();
  });

  it("rejects malformed and invalid payloads", () => {
    expect(parseWorkspaceFileDragPayload("not json")).toBeNull();
    expect(
      parseWorkspaceFileDragPayload(
        JSON.stringify({
          ...payload(),
          attachment: {
            kind: "workspace_file",
            path: "src/app.ts",
            selection: { kind: "line_range", startLine: 24, endLine: 12 },
          },
        }),
      ),
    ).toBeNull();
  });

  it.each([
    payload(),
    { ...payload(), attachment: createDirectoryComposerAttachment("/workspace/src") },
  ])(
    "accepts $attachment.kind drops only within the originating server and workspace",
    (dragged) => {
      expect(
        resolveWorkspaceFileDrop({
          payload: dragged,
          serverId: "server-1",
          workspaceId: "workspace-1",
        }),
      ).toEqual(dragged.attachment);
      expect(
        resolveWorkspaceFileDrop({
          payload: dragged,
          serverId: "server-1",
          workspaceId: "workspace-2",
        }),
      ).toBeNull();
      expect(
        resolveWorkspaceFileDrop({
          payload: dragged,
          serverId: "server-2",
          workspaceId: "workspace-1",
        }),
      ).toBeNull();
    },
  );
});

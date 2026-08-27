import { describe, expect, it } from "vitest";
import { findWorkspaceConversationAgentId } from "./use-reference-workspace-content";

describe("workspace conversation references", () => {
  it("selects the newest root conversation from history order", () => {
    expect(
      findWorkspaceConversationAgentId(
        [
          { id: "child", workspaceId: "workspace-1", parentAgentId: "root-new" },
          { id: "root-new", workspaceId: "workspace-1", parentAgentId: null },
          { id: "root-old", workspaceId: "workspace-1", parentAgentId: null },
        ],
        "workspace-1",
      ),
    ).toBe("root-new");
  });

  it("treats an agent whose parent belongs to another workspace as a root", () => {
    expect(
      findWorkspaceConversationAgentId(
        [
          { id: "root", workspaceId: "workspace-1", parentAgentId: "outside-parent" },
          { id: "outside-parent", workspaceId: "workspace-2", parentAgentId: null },
        ],
        "workspace-1",
      ),
    ).toBe("root");
  });

  it("returns null when the workspace has no conversation", () => {
    expect(
      findWorkspaceConversationAgentId(
        [{ id: "root", workspaceId: "workspace-2", parentAgentId: null }],
        "workspace-1",
      ),
    ).toBeNull();
  });
});

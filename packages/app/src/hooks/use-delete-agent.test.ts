import { describe, expect, it, vi } from "vitest";
import { deleteAgentOrWorkspace, removeAgentFromHistoryPayload } from "./use-delete-agent";

describe("deleteAgentOrWorkspace", () => {
  it("deletes the owning workspace so the sidebar removes its row", async () => {
    const client = {
      deleteAgent: vi.fn(),
      deleteWorkspace: vi.fn().mockResolvedValue({ error: null }),
    };

    await deleteAgentOrWorkspace(client, {
      serverId: "server-a",
      agentId: "agent-1",
      workspaceId: "workspace-1",
    });

    expect(client.deleteWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(client.deleteAgent).not.toHaveBeenCalled();
  });

  it("falls back to agent deletion when history has no workspace", async () => {
    const client = {
      deleteAgent: vi.fn().mockResolvedValue(undefined),
      deleteWorkspace: vi.fn(),
    };

    await deleteAgentOrWorkspace(client, {
      serverId: "server-a",
      agentId: "agent-1",
    });

    expect(client.deleteAgent).toHaveBeenCalledWith("agent-1");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });
});

describe("removeAgentFromHistoryPayload", () => {
  it("removes only the deleted host-scoped agent from every history page", () => {
    const payload = {
      pages: [
        {
          agents: [
            { id: "shared-id", serverId: "server-a" },
            { id: "shared-id", serverId: "server-b" },
          ],
        },
        { agents: [{ id: "other", serverId: "server-a" }] },
      ],
    };

    const result = removeAgentFromHistoryPayload(payload, {
      serverId: "server-a",
      agentId: "shared-id",
    });

    expect(result.pages).toEqual([
      { agents: [{ id: "shared-id", serverId: "server-b" }] },
      { agents: [{ id: "other", serverId: "server-a" }] },
    ]);
  });

  it("preserves payload identity when the deleted agent is absent", () => {
    const payload = { pages: [{ agents: [{ id: "other", serverId: "server-a" }] }] };

    expect(
      removeAgentFromHistoryPayload(payload, {
        serverId: "server-a",
        agentId: "missing",
      }),
    ).toBe(payload);
  });
});

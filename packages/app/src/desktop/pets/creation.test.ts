import { beforeEach, describe, expect, it, vi } from "vitest";
import { launchDesktopPetCreation } from "./creation";

const state = vi.hoisted(() => ({
  workspaces: new Map<string, Record<string, unknown>>(),
  agents: new Map<string, Record<string, unknown>>(),
  createWorkspace: vi.fn(),
  createAgent: vi.fn(),
  navigate: vi.fn(),
  handoff: vi.fn(),
}));
vi.mock("@/stores/session-store", () => ({
  normalizeWorkspaceDescriptor: (workspace: unknown) => workspace,
  useSessionStore: {
    getState: () => ({
      mergeWorkspaces: (
        _serverId: string,
        workspaces: Array<Record<string, unknown> & { id: string }>,
      ) => {
        for (const workspace of workspaces) state.workspaces.set(workspace.id, workspace);
      },
      setHasHydratedWorkspaces: vi.fn(),
      setAgents: (
        _serverId: string,
        update: (previous: typeof state.agents) => typeof state.agents,
      ) => {
        state.agents = update(state.agents);
      },
    }),
  },
}));
vi.mock("@/utils/agent-snapshots", () => ({
  normalizeAgentSnapshot: (agent: Record<string, unknown>, serverId: string) => ({
    ...agent,
    serverId,
  }),
}));
vi.mock("@/workspace/legacy-daemon-workspaces", () => ({
  applyLegacyDaemonWorkspaceOwnership: ({ agent }: { agent: unknown }) => agent,
}));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: state.navigate }));
vi.mock("@/composer/submission/writer", () => ({
  handoffCreatedAgentMessageSubmission: state.handoff,
}));

const preferences = {
  provider: "omp",
  model: "configured-provider/configured-model",
  modeId: "full",
  thinkingOptionId: "high",
  featureValues: { workflow_mode: "build" },
};
const originalWorkspace = { id: "existing-workspace", workspaceDirectory: "/existing" };
const originalAgent = {
  id: "existing-conversation",
  workspaceId: "existing-workspace",
  title: "Keep me",
};

beforeEach(() => {
  vi.resetAllMocks();
  state.workspaces = new Map([[originalWorkspace.id, originalWorkspace]]);
  state.agents = new Map([[originalAgent.id, originalAgent]]);
  let number = 0;
  state.createWorkspace.mockImplementation(async (request: { source: { path: string } }) => ({
    workspace: { id: `author-${++number}`, workspaceDirectory: request.source.path },
    error: null,
  }));
  state.createAgent.mockImplementation(async (request: { workspaceId: string }) => ({
    id: `pet-agent-${request.workspaceId}`,
    workspaceId: request.workspaceId,
  }));
});

const client = { createWorkspace: state.createWorkspace, createAgent: state.createAgent };

describe("Create with OMP", () => {
  it("isolates authoring conversations and preserves the user's existing workspace", async () => {
    const first = await launchDesktopPetCreation({
      serverId: "local",
      client,
      preferences,
      workspace: {
        cwd: "/pet-author/one",
        initialPrompt: "Create the fluffy kitten using hatch-pet and install helper",
      },
    });
    const second = await launchDesktopPetCreation({
      serverId: "local",
      client,
      preferences,
      workspace: { cwd: "/pet-author/two", initialPrompt: "Create a different real pet" },
    });
    expect(first.agentId).not.toBe(second.agentId);
    expect(state.workspaces.get(originalWorkspace.id)).toBe(originalWorkspace);
    expect(state.agents.get(originalAgent.id)).toBe(originalAgent);
    expect([...state.workspaces.keys()]).toEqual(["existing-workspace", "author-1", "author-2"]);
    expect([...state.agents.keys()]).toEqual([
      "existing-conversation",
      first.agentId,
      second.agentId,
    ]);
    expect(state.navigate).toHaveBeenLastCalledWith({ serverId: "local", agentId: second.agentId });
  });

  it("does not navigate or overwrite the current conversation when workspace creation fails", async () => {
    state.createWorkspace.mockResolvedValue({ workspace: null, error: "Local host disconnected" });
    await expect(
      launchDesktopPetCreation({
        serverId: "local",
        client,
        preferences,
        workspace: { cwd: "/pet-author/failure", initialPrompt: "Create pet" },
      }),
    ).rejects.toThrow("Local host disconnected");
    expect(state.createAgent).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect([...state.workspaces.values()]).toEqual([originalWorkspace]);
    expect([...state.agents.values()]).toEqual([originalAgent]);
  });

  it("surfaces model/generation launch errors without a fake conversation or pet", async () => {
    state.createAgent.mockRejectedValue(new Error("Configured model unavailable"));
    await expect(
      launchDesktopPetCreation({
        serverId: "local",
        client,
        preferences,
        workspace: { cwd: "/pet-author/no-model", initialPrompt: "Create pet" },
      }),
    ).rejects.toThrow("Configured model unavailable");
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.handoff).not.toHaveBeenCalled();
    expect([...state.agents.values()]).toEqual([originalAgent]);
  });
});

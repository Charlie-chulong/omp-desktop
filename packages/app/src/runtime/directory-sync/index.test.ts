import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient, FetchAgentsEntry } from "@omp-desktop/client/internal/daemon-client";
import type { AgentSnapshotPayload, SessionOutboundMessage } from "@omp-desktop/protocol/messages";
import { normalizeProjectDescriptor, useSessionStore } from "@/stores/session-store";
import { DirectoryRefreshSupersededError, DirectorySync } from "./index";

type WorkspaceFetchResult = Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>;
type ProjectListResult = Awaited<ReturnType<DaemonClient["listProjects"]>>;
type AgentFetchResult = Extract<
  SessionOutboundMessage,
  { type: "fetch_agents_response" }
>["payload"];

class FakeDirectoryClient {
  fetchAgentsCalls = 0;
  lastAgentOptions: unknown;
  fetchWorkspacesCalls = 0;
  listProjectsCalls = 0;
  lastProjectOptions: unknown;
  projectResult: ProjectListResult | null = null;
  agentResult: AgentFetchResult | null = null;
  private pendingWorkspaceFetch: Promise<WorkspaceFetchResult> | null = null;
  private readonly handlers = new Map<
    SessionOutboundMessage["type"],
    Set<(message: SessionOutboundMessage) => void>
  >();

  on<TType extends SessionOutboundMessage["type"]>(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void {
    const handlers = this.handlers.get(type) ?? new Set();
    const registered = handler as unknown as (message: SessionOutboundMessage) => void;
    handlers.add(registered);
    this.handlers.set(type, handlers);
    return () => handlers.delete(registered);
  }

  emit<TType extends SessionOutboundMessage["type"]>(
    message: Extract<SessionOutboundMessage, { type: TType }>,
  ): void {
    for (const handler of this.handlers.get(message.type) ?? []) handler(message);
  }

  holdWorkspaceFetch(): (result: WorkspaceFetchResult) => void {
    let complete!: (result: WorkspaceFetchResult) => void;
    this.pendingWorkspaceFetch = new Promise((resolve) => {
      complete = resolve;
    });
    return complete;
  }

  async fetchAgents(options?: unknown): Promise<Awaited<ReturnType<DaemonClient["fetchAgents"]>>> {
    this.fetchAgentsCalls += 1;
    this.lastAgentOptions = options;
    if (this.agentResult) return this.agentResult;
    return {
      requestId: "agents",
      entries: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  async fetchWorkspaces(): Promise<WorkspaceFetchResult> {
    this.fetchWorkspacesCalls += 1;
    if (this.pendingWorkspaceFetch) {
      const pending = this.pendingWorkspaceFetch;
      this.pendingWorkspaceFetch = null;
      return pending;
    }
    return {
      requestId: "workspaces",
      entries: [],
      emptyProjects: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  async listProjects(options?: unknown): Promise<ProjectListResult> {
    this.listProjectsCalls += 1;
    this.lastProjectOptions = options;
    if (this.projectResult) return this.projectResult;
    return {
      requestId: "projects",
      projects: [
        {
          projectId: "project-1",
          projectKey: "remote:github.com/acme/app",
          projectDisplayName: "acme/app",
          projectRootPath: "/repo/app",
          projectKind: "git",
        },
      ],
    };
  }
}

const serverIds = new Set<string>();

function createDirectory(serverId: string): {
  client: FakeDirectoryClient;
  directory: DirectorySync;
} {
  serverIds.add(serverId);
  const client = new FakeDirectoryClient();
  const directory = new DirectorySync(serverId, {
    onAgentStoppedRunning: () => undefined,
    markAgentLoading: () => undefined,
    markAgentReady: () => undefined,
    markAgentError: () => undefined,
    onAgentDirectoryCommitted: () => undefined,
  });
  directory.connectionChanged({
    client: client as unknown as DaemonClient,
    status: "online",
    source: { clientGeneration: 1, connectionEpoch: 1 },
  });
  return { client, directory };
}

afterEach(() => {
  for (const serverId of serverIds) useSessionStore.getState().clearSession(serverId);
  serverIds.clear();
});

describe("DirectorySync session readiness", () => {
  it("revalidates a persisted agent generation with a full bounded bootstrap snapshot", async () => {
    const serverId = "agent-list-sequence-page";
    serverIds.add(serverId);
    const client = new FakeDirectoryClient();
    const directory = new DirectorySync(
      serverId,
      {
        onAgentStoppedRunning: () => undefined,
        markAgentLoading: () => undefined,
        markAgentReady: () => undefined,
        markAgentError: () => undefined,
      },
      {
        readDirectoryCheckpoint: () => ({ agents: { generation: "generation", afterSeq: 12 } }),
        writeDirectoryCheckpoint: () => undefined,
      },
    );
    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { directorySync: true, workspaceMultiplicity: true },
    });

    await directory.refreshAgents({
      subscribe: { subscriptionId: `app:${serverId}` },
      page: { limit: 200 },
    });

    expect(client.lastAgentOptions).toEqual({
      scope: "active",
      sort: [{ key: "updated_at", direction: "desc" }],
      subscribe: { subscriptionId: `app:${serverId}` },
      page: { limit: 200 },
      sync: { generation: "generation" },
    });
    directory.dispose();
  });

  it("waits for workspace capability metadata before choosing the workspace protocol", async () => {
    const serverId = "workspace-metadata";
    const { client, directory } = createDirectory(serverId);

    const refresh = directory.refreshWorkspaces({ subscribe: true });
    await Promise.resolve();
    expect(client.fetchWorkspacesCalls).toBe(0);

    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    await Promise.resolve();
    expect(client.fetchWorkspacesCalls).toBe(0);

    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true },
    });
    await refresh;

    expect(client.fetchWorkspacesCalls).toBe(1);
    expect(useSessionStore.getState().sessions[serverId]?.hasHydratedWorkspaces).toBe(true);
    directory.dispose();
  });

  it("fetches the project descriptor channel when the daemon advertises it", async () => {
    const serverId = "project-list";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true, projectList: true },
    });

    await directory.refreshWorkspaces();

    expect(client.listProjectsCalls).toBe(1);
    expect(useSessionStore.getState().sessions[serverId]?.projects.get("project-1")).toMatchObject({
      projectId: "project-1",
      projectKey: "remote:github.com/acme/app",
    });
    directory.dispose();
  });

  it("merges project changes from the existing list RPC and advances its cursor", async () => {
    const serverId = "project-list-sequence";
    serverIds.add(serverId);
    const client = new FakeDirectoryClient();
    const writes: unknown[] = [];
    const directory = new DirectorySync(
      serverId,
      {
        onAgentStoppedRunning: () => undefined,
        markAgentLoading: () => undefined,
        markAgentReady: () => undefined,
        markAgentError: () => undefined,
      },
      {
        readDirectoryCheckpoint: () => ({ projects: { generation: "generation", afterSeq: 4 } }),
        writeDirectoryCheckpoint: (_serverId, checkpoint) => writes.push(checkpoint),
      },
    );
    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.setProjects(serverId, [
      normalizeProjectDescriptor({
        projectId: "project-1",
        projectDisplayName: "Old name",
        projectRootPath: "/repo/one",
        projectKind: "git",
      }),
      normalizeProjectDescriptor({
        projectId: "project-2",
        projectDisplayName: "Removed",
        projectRootPath: "/repo/two",
        projectKind: "git",
      }),
    ]);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true, projectList: true, directorySync: true },
    });
    client.projectResult = {
      requestId: "projects",
      projects: [
        {
          projectId: "project-1",
          projectDisplayName: "New name",
          projectRootPath: "/repo/one",
          projectKind: "git",
          syncSeq: 5,
        },
      ],
      sync: {
        generation: "generation",
        headSeq: 6,
        mode: "changes",
        removals: [{ id: "project-2", seq: 6 }],
      },
    };

    await directory.refreshWorkspaces();

    expect(client.lastProjectOptions).toEqual({
      sync: { generation: "generation", afterSeq: 4 },
    });
    const projects = useSessionStore.getState().sessions[serverId]?.projects;
    expect(Array.from(projects?.keys() ?? [])).toEqual(["project-1"]);
    expect(projects?.get("project-1")?.projectDisplayName).toBe("New name");
    expect(writes).toContainEqual({ projects: { generation: "generation", afterSeq: 6 } });
    directory.dispose();
  });

  it("rejects a session wait on disconnect so the reconnect can refresh", async () => {
    const serverId = "session-wait-reconnect";
    const { client, directory } = createDirectory(serverId);
    const staleRefresh = directory.refreshAgents();
    await Promise.resolve();

    directory.connectionChanged({
      client: null,
      status: "offline",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    await expect(staleRefresh).rejects.toBeInstanceOf(DirectoryRefreshSupersededError);

    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 2 },
    });
    const currentRefresh = directory.refreshAgents();
    useSessionStore.getState().initializeSession(serverId, client as unknown as DaemonClient, 1);
    await currentRefresh;

    expect(client.fetchAgentsCalls).toBe(1);
    directory.dispose();
  });

  it("buffers workspace and project updates in the same hydration transaction", async () => {
    const serverId = "workspace-project-transaction";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true },
    });
    const completeFetch = client.holdWorkspaceFetch();

    const refresh = directory.refreshWorkspaces({ subscribe: true });
    await Promise.resolve();
    client.emit({
      type: "workspace_update",
      payload: {
        kind: "remove",
        id: "removed-workspace",
        emptyProject: {
          projectId: "workspace-project",
          projectDisplayName: "Project from workspace update",
          projectRootPath: "/repo/workspace-project",
          projectKind: "git",
        },
      },
    });
    client.emit({
      type: "project.update",
      payload: {
        kind: "upsert",
        project: {
          projectId: "snapshot-project",
          projectDisplayName: "Renamed during hydration",
          projectRootPath: "/moved/snapshot-project",
          projectKind: "directory",
        },
      },
    });
    completeFetch({
      requestId: "workspaces",
      entries: [],
      emptyProjects: [
        {
          projectId: "snapshot-project",
          projectDisplayName: "Stale snapshot project",
          projectRootPath: "/repo/snapshot-project",
          projectKind: "git",
        },
      ],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    });
    await refresh;

    const projects = useSessionStore.getState().sessions[serverId]?.projects;
    expect(Array.from(projects?.keys() ?? [])).toEqual(["snapshot-project", "workspace-project"]);
    expect(projects?.get("snapshot-project")).toMatchObject({
      projectDisplayName: "Renamed during hydration",
      projectRootPath: "/moved/snapshot-project",
      projectKind: "directory",
    });
    expect(projects?.get("workspace-project")).toMatchObject({
      projectDisplayName: "Project from workspace update",
    });
    directory.dispose();
  });

  it("buffers project updates from the online epoch before workspace hydration starts", async () => {
    const serverId = "project-before-workspace-hydration";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true },
    });

    client.emit({
      type: "project.update",
      payload: {
        kind: "upsert",
        project: {
          projectId: "early-project",
          projectDisplayName: "Early project",
          projectRootPath: "/repo/early-project",
          projectKind: "git",
        },
      },
    });

    expect(useSessionStore.getState().sessions[serverId]?.hasHydratedWorkspaces).toBe(false);

    await directory.refreshWorkspaces({ subscribe: true });

    expect(useSessionStore.getState().sessions[serverId]?.hasHydratedWorkspaces).toBe(true);
    expect(
      useSessionStore.getState().sessions[serverId]?.projects.get("early-project"),
    ).toMatchObject({
      projectDisplayName: "Early project",
      projectRootPath: "/repo/early-project",
    });
    directory.dispose();
  });
});

function petDirectoryEntry(overrides: Partial<AgentSnapshotPayload> = {}): FetchAgentsEntry {
  return {
    agent: {
      id: "agent",
      provider: "codex",
      cwd: "/repo",
      model: null,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:01:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Task",
      labels: {},
      requiresAttention: true,
      attentionReason: "finished",
      attentionTimestamp: "2026-07-17T00:01:00.000Z",
      ...overrides,
    },
    project: {
      projectKey: "/repo",
      projectName: "repo",
      checkout: {
        cwd: "/repo",
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function agentSnapshot(
  entries: FetchAgentsEntry[],
  generation: string,
  headSeq: number,
  mode: "snapshot" | "changes" = "snapshot",
): AgentFetchResult {
  return {
    requestId: "agents",
    entries,
    pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    sync: { mode, generation, headSeq, removals: [] },
  };
}

describe("DirectorySync pet publication authority", () => {
  it("refreshes unsequenced workspace attention clearing and keeps the committed view isolated", async () => {
    const serverId = "pet-committed-directory";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { directorySync: true, workspaceMultiplicity: true },
    });
    client.agentResult = agentSnapshot([petDirectoryEntry()], "g1", 1);
    await directory.refreshAgents();
    const ready = directory.getAgentPublication();
    const clear = petDirectoryEntry({
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
    });
    client.agentResult = agentSnapshot([clear], "g1", 2, "changes");
    client.emit({ type: "agent_update", payload: { kind: "upsert", ...clear } });
    // An unnumbered event is applied to UI immediately, but cannot invent coverage.
    expect(
      useSessionStore.getState().sessions[serverId]?.agents.get("agent")?.requiresAttention,
    ).toBe(false);
    expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 1 });
    await vi.waitFor(() => {
      expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 2 });
    });
    expect(client.lastAgentOptions).toMatchObject({ sync: { generation: "g1", afterSeq: 1 } });
    expect(directory.getAgentPublication()?.agents.get("agent")?.requiresAttention).toBe(false);
    expect(ready?.agents.get("agent")?.requiresAttention).toBe(true);

    store.setAgents(serverId, (agents) => {
      const next = new Map(agents);
      const agent = next.get("agent")!;
      next.set("agent", { ...agent, requiresAttention: true, attentionReason: "finished" });
      return next;
    });
    const other = petDirectoryEntry({ id: "other", status: "running", requiresAttention: false });
    client.agentResult = agentSnapshot([other], "g1", 3, "changes");
    client.emit({
      type: "agent_update",
      payload: { kind: "upsert", ...other, generation: "g1", seq: 3 },
    });
    await vi.waitFor(() => {
      expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 3 });
    });
    expect(directory.getAgentPublication()?.agents.get("agent")?.requiresAttention).toBe(false);
    expect(directory.getAgentPublication()?.agents.get("other")?.status).toBe("running");
    // Empty/other-entity directory changes retain the existing UI merge base.
    expect(
      useSessionStore.getState().sessions[serverId]?.agents.get("agent")?.requiresAttention,
    ).toBe(true);
    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "offline",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    expect(directory.getAgentPublication()).toBeNull();
    directory.dispose();
  });

  it("accepts B:12 before A:11 and only advances complete coverage after a coalesced read", async () => {
    const serverId = "pet-cross-entity-order";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { directorySync: true, workspaceMultiplicity: true },
    });
    const initialA = petDirectoryEntry({ id: "A", requiresAttention: false });
    const initialB = petDirectoryEntry({ id: "B", requiresAttention: false });
    client.agentResult = agentSnapshot([initialA, initialB], "g1", 10);
    await directory.refreshAgents();
    const changedA = petDirectoryEntry({ id: "A", requiresAttention: true });
    const changedB = petDirectoryEntry({ id: "B", status: "running", requiresAttention: false });
    client.agentResult = agentSnapshot([changedA, changedB], "g1", 12, "changes");
    client.emit({
      type: "agent_update",
      payload: { kind: "upsert", ...changedB, generation: "g1", seq: 12 },
    });
    client.emit({
      type: "agent_update",
      payload: { kind: "upsert", ...changedA, generation: "g1", seq: 11 },
    });
    expect(useSessionStore.getState().sessions[serverId]?.agents.get("A")?.requiresAttention).toBe(
      true,
    );
    expect(useSessionStore.getState().sessions[serverId]?.agents.get("B")?.status).toBe("running");
    expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 10 });
    await vi.waitFor(() => {
      expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 12 });
    });
    expect(client.fetchAgentsCalls).toBe(2);
    expect(client.lastAgentOptions).toMatchObject({ sync: { generation: "g1", afterSeq: 10 } });
    expect(directory.getAgentPublication()?.agents.get("A")?.requiresAttention).toBe(true);
    expect(directory.getAgentPublication()?.agents.get("B")?.status).toBe("running");
    directory.dispose();
  });

  it("does not claim buffered events beyond a fetch head and fills the gap with a directory read", async () => {
    const serverId = "pet-buffered-sequence";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { directorySync: true, workspaceMultiplicity: true },
    });
    client.fetchAgents = async () => {
      client.emit({
        type: "agent_update",
        payload: { kind: "upsert", ...petDirectoryEntry(), generation: "g1", seq: 1 },
      });
      return agentSnapshot(
        [
          petDirectoryEntry({
            requiresAttention: false,
            attentionReason: null,
            attentionTimestamp: null,
          }),
        ],
        "g1",
        2,
      );
    };
    await directory.refreshAgents();
    expect(directory.getAgentPublication()?.agents.get("agent")?.requiresAttention).toBe(false);
    expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 2 });
    const running = petDirectoryEntry({
      status: "running",
      requiresAttention: false,
      updatedAt: "2026-07-17T00:00:30.000Z",
    });
    client.fetchAgents = async () => {
      client.fetchAgents = async () => agentSnapshot([running], "g1", 3, "changes");
      client.emit({
        type: "agent_update",
        payload: { kind: "upsert", ...running, generation: "g1", seq: 3 },
      });
      return agentSnapshot([petDirectoryEntry()], "g1", 2);
    };
    await directory.refreshAgents();
    // No live max(seq) watermark: the fetched map is still exactly at head 2.
    expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 2 });
    await vi.waitFor(() => {
      expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g1", seq: 3 });
    });
    expect(directory.getAgentPublication()?.agents.get("agent")?.status).toBe("running");
    directory.dispose();
  });

  it("never feeds the pet map into the UI base on an empty incremental refresh", async () => {
    const serverId = "pet-ui-base-isolation";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { directorySync: true, workspaceMultiplicity: true },
    });
    client.agentResult = agentSnapshot(
      [
        petDirectoryEntry({
          status: "idle",
          requiresAttention: false,
          updatedAt: "2026-07-17T00:00:10.000Z",
        }),
      ],
      "g1",
      11,
    );
    await directory.refreshAgents();
    store.setAgents(serverId, (agents) => {
      const next = new Map(agents);
      const agent = next.get("agent")!;
      next.set("agent", {
        ...agent,
        status: "running",
        updatedAt: new Date("2026-07-17T00:00:20.000Z"),
      });
      return next;
    });
    // A lower-timestamp live idle update is rejected by the unchanged UI policy.
    client.emit({
      type: "agent_update",
      payload: {
        kind: "upsert",
        ...petDirectoryEntry({
          status: "idle",
          requiresAttention: false,
          updatedAt: "2026-07-17T00:00:10.000Z",
        }),
        generation: "g1",
        seq: 11,
      },
    });
    client.agentResult = agentSnapshot([], "g1", 11, "changes");
    await directory.refreshAgents();
    expect(useSessionStore.getState().sessions[serverId]?.agents.get("agent")?.status).toBe(
      "running",
    );
    expect(directory.getAgentPublication()?.agents.get("agent")?.status).toBe("idle");
    directory.dispose();
  });

  it("proves an unordered daemon generation change by rereading against the requested epoch", async () => {
    const serverId = "pet-generation-proof";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { directorySync: true, workspaceMultiplicity: true },
    });
    client.agentResult = agentSnapshot([petDirectoryEntry()], "g2", 1);
    await directory.refreshAgents();
    expect(directory.getAgentPublication()?.revision).toEqual({ generation: "g2", seq: 1 });
    await directory.refreshAgents({ expectedGeneration: "g1" });
    expect(client.lastAgentOptions).toMatchObject({ sync: { generation: "g1" } });
    expect(directory.getAgentPublication()?.revision).toEqual({
      generation: "g2",
      seq: 1,
      previousGeneration: "g1",
    });
    client.agentResult = agentSnapshot([petDirectoryEntry()], "g2", 2, "changes");
    client.emit({
      type: "agent_update",
      payload: { kind: "upsert", ...petDirectoryEntry(), generation: "g2", seq: 2 },
    });
    await vi.waitFor(() => {
      expect(directory.getAgentPublication()?.revision).toEqual({
        generation: "g2",
        seq: 2,
        previousGeneration: "g1",
      });
    });
    directory.dispose();
  });
});

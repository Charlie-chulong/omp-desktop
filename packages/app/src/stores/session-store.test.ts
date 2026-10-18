import { afterEach, describe, expect, it } from "vitest";

import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import type { WorkspaceDescriptorPayload } from "@omp-desktop/protocol/messages";

import {
  normalizeWorkspaceDescriptor,
  selectAgentTurnPresentation,
  selectAgentTimelineState,
  useSessionStore,
  type AgentFileExplorerState,
  type WorkspaceDescriptor,
} from "./session-store";
import type { StreamItem } from "../types/stream";
import { patchWorkspaceScripts } from "../contexts/session-workspace-scripts";

function createWorkspace(
  input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project 1",
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "local_checkout",
    name: input.name ?? "main",
    status: input.status ?? "done",
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: input.archivingAt ?? null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
  };
}

afterEach(() => {
  useSessionStore.getState().clearSession("test-server");
});

function initializeTestSession(): void {
  useSessionStore.getState().initializeSession("test-server", null as unknown as DaemonClient);
}

function getTestSessionReferences() {
  const state = useSessionStore.getState();
  const session = state.sessions["test-server"];
  if (!session) {
    throw new Error("test session is not initialized");
  }
  return {
    sessions: state.sessions,
    session,
    workspaces: session.workspaces,
  };
}

function submittedMessage(clientMessageId: string): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id: clientMessageId,
    clientMessageId,
    text: clientMessageId,
    timestamp: new Date("2026-07-31T10:00:00.000Z"),
  };
}

function hasSubmittedMessage(items: readonly StreamItem[] | undefined, clientMessageId: string) {
  return items?.some(
    (item) => item.kind === "user_message" && item.clientMessageId === clientMessageId,
  );
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((suffix) =>
      [value].concat(suffix),
    ),
  );
}

function taskTexts(tasks: ReadonlyArray<{ text: string }>): string[] {
  return tasks.map((task) => task.text);
}

describe("queued conversation ordering", () => {
  function queuedMessages(...ids: string[]) {
    return ids.map((id) => ({ id, text: id, attachments: [] }));
  }

  function initializeQueues(agentIds: readonly string[] = ["a", "b", "c"]) {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.setQueuedMessages(
      "test-server",
      new Map(agentIds.map((agentId) => [agentId, queuedMessages(`${agentId}-1`)])),
    );
    return store;
  }

  afterEach(() => {
    useSessionStore.getState().clearSession("other-server");
  });

  it("moves the last conversation to the front without changing its messages or session state", () => {
    const store = initializeQueues(["a", "b", "c", "d", "e"]);
    store.setQueuedMessages("test-server", (current) => {
      const next = new Map(current);
      next.set("e", queuedMessages("e-1", "e-2"));
      return next;
    });
    const before = useSessionStore.getState().sessions["test-server"]!;
    const order = ["e", "a", "b", "c", "d"] as const;

    store.reorderQueuedAgents("test-server", order);

    const after = useSessionStore.getState().sessions["test-server"]!;
    expect(after.queuedAgentOrder).toEqual(order);
    expect(after.queuedAgentOrder).not.toBe(order);
    expect(after).toEqual({ ...before, queuedAgentOrder: [...order] });
    expect(after.queuedMessages).toBe(before.queuedMessages);
    expect(after.queuedMessages.get("e")).toBe(before.queuedMessages.get("e"));
    expect(after.queuedMessages.get("e")?.map((message) => message.id)).toEqual(["e-1", "e-2"]);
    expect(before.queuedAgentOrder).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("preserves state identity for the same order or a missing host", () => {
    const store = initializeQueues();
    const before = useSessionStore.getState();

    store.reorderQueuedAgents("test-server", ["a", "b", "c"]);
    expect(useSessionStore.getState()).toBe(before);

    store.reorderQueuedAgents("missing-server", ["c", "a", "b"]);
    expect(useSessionStore.getState()).toBe(before);
  });

  it("preserves state identity for empty and single-conversation queues", () => {
    const store = initializeQueues([]);
    const empty = useSessionStore.getState();
    store.reorderQueuedAgents("test-server", []);
    expect(useSessionStore.getState()).toBe(empty);

    store.setQueuedMessages("test-server", new Map([["a", queuedMessages("a-1")]]));
    const single = useSessionStore.getState();
    store.reorderQueuedAgents("test-server", ["a"]);
    expect(useSessionStore.getState()).toBe(single);
  });

  it.each([
    { reason: "duplicate IDs", order: ["c", "a", "a"] },
    { reason: "unknown IDs", order: ["c", "unknown", "a"] },
    { reason: "missing IDs", order: ["c", "a"] },
    { reason: "extra IDs", order: ["d", "c", "a", "b"] },
    { reason: "an empty result", order: [] },
  ])("rejects $reason without publishing any state change", ({ order }) => {
    const store = initializeQueues();
    const before = useSessionStore.getState();

    store.reorderQueuedAgents("test-server", order);

    expect(useSessionStore.getState()).toBe(before);
    expect(before.sessions["test-server"]?.queuedAgentOrder).toEqual(["a", "b", "c"]);
  });

  it.each(["removed", "empty"] as const)(
    "rejects a drag result when a conversation has drained and its queue is %s",
    (drainedState) => {
      const store = initializeQueues();
      const draggedOrder = ["c", "a", "b"];
      store.setQueuedMessages("test-server", (current) => {
        const next = new Map(current);
        if (drainedState === "removed") next.delete("b");
        else next.set("b", []);
        return next;
      });
      const before = useSessionStore.getState();

      store.reorderQueuedAgents("test-server", draggedOrder);

      expect(useSessionStore.getState()).toBe(before);
      expect(before.sessions["test-server"]?.queuedMessages.get("b")).toEqual(
        drainedState === "removed" ? undefined : [],
      );
    },
  );

  it("rejects a drag result when another conversation was enqueued", () => {
    const store = initializeQueues();
    const draggedOrder = ["c", "a", "b"];
    store.setQueuedMessages("test-server", (current) => {
      const next = new Map(current);
      next.set("d", queuedMessages("d-1"));
      return next;
    });
    const before = useSessionStore.getState();

    store.reorderQueuedAgents("test-server", draggedOrder);

    expect(useSessionStore.getState()).toBe(before);
    expect(before.sessions["test-server"]?.queuedAgentOrder).toEqual(["a", "b", "c", "d"]);
    expect(before.sessions["test-server"]?.queuedMessages.get("d")?.[0]?.id).toBe("d-1");
  });

  it("rejects an equally sized stale order after a drained conversation was replaced", () => {
    const store = initializeQueues();
    const draggedOrder = ["c", "a", "b"];
    store.setQueuedMessages("test-server", (current) => {
      const next = new Map(current);
      next.delete("b");
      next.set("d", queuedMessages("d-1"));
      return next;
    });
    const before = useSessionStore.getState();

    store.reorderQueuedAgents("test-server", draggedOrder);

    expect(useSessionStore.getState()).toBe(before);
    expect(before.sessions["test-server"]?.queuedAgentOrder).toEqual(["a", "c", "d"]);
    expect(before.sessions["test-server"]?.queuedMessages.has("b")).toBe(false);
  });

  it("uses the latest messages when the active conversation set is unchanged", () => {
    const store = initializeQueues();
    const draggedOrder = ["c", "a", "b"];
    store.setQueuedMessages("test-server", (current) => {
      const next = new Map(current);
      next.set("a", queuedMessages("a-1", "a-2"));
      return next;
    });
    const before = useSessionStore.getState().sessions["test-server"]!;

    store.reorderQueuedAgents("test-server", draggedOrder);

    const after = useSessionStore.getState().sessions["test-server"]!;
    expect(after.queuedAgentOrder).toEqual(draggedOrder);
    expect(after.queuedMessages).toBe(before.queuedMessages);
    expect(after.queuedMessages.get("a")?.map((message) => message.id)).toEqual(["a-1", "a-2"]);
  });

  it("validates against nonempty queues rather than retained empty map entries", () => {
    const store = initializeQueues();
    store.setQueuedMessages("test-server", (current) => {
      const next = new Map(current);
      next.set("b", []);
      return next;
    });
    const before = useSessionStore.getState();

    store.reorderQueuedAgents("test-server", ["c", "b"]);
    expect(useSessionStore.getState()).toBe(before);

    store.reorderQueuedAgents("test-server", ["c", "a"]);
    const after = useSessionStore.getState().sessions["test-server"]!;
    expect(after.queuedAgentOrder).toEqual(["c", "a"]);
    expect(after.queuedMessages).toBe(before.sessions["test-server"]?.queuedMessages);
    expect(after.queuedMessages.get("b")).toEqual([]);
  });

  it("preserves the selected order while queue updates append newly active conversations", () => {
    const store = initializeQueues();
    store.reorderQueuedAgents("test-server", ["c", "a", "b"]);

    store.setQueuedMessages(
      "test-server",
      new Map([
        ["b", queuedMessages("b-1", "b-2")],
        ["d", queuedMessages("d-1")],
        ["a", queuedMessages("a-1")],
        ["c", queuedMessages("c-1")],
      ]),
    );

    expect(useSessionStore.getState().sessions["test-server"]?.queuedAgentOrder).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("keeps hosts isolated even when they share conversation IDs", () => {
    const store = initializeQueues();
    store.initializeSession("other-server", null);
    store.setQueuedMessages(
      "other-server",
      new Map([
        ["a", queuedMessages("other-a-1")],
        ["b", queuedMessages("other-b-1")],
        ["other-only", queuedMessages("other-only-1")],
      ]),
    );
    const before = useSessionStore.getState();

    store.reorderQueuedAgents("test-server", ["c", "other-only", "a"]);
    expect(useSessionStore.getState()).toBe(before);

    store.reorderQueuedAgents("test-server", ["c", "a", "b"]);
    const reordered = useSessionStore.getState();
    expect(reordered.sessions["test-server"]?.queuedAgentOrder).toEqual(["c", "a", "b"]);
    expect(reordered.sessions["other-server"]).toBe(before.sessions["other-server"]);
    expect(reordered.sessions["test-server"]?.queuedMessages).toBe(
      before.sessions["test-server"]?.queuedMessages,
    );

    store.reorderQueuedAgents("other-server", ["other-only", "b", "a"]);
    const after = useSessionStore.getState();
    expect(after.sessions["test-server"]).toBe(reordered.sessions["test-server"]);
    expect(after.sessions["other-server"]?.queuedAgentOrder).toEqual(["other-only", "b", "a"]);
    expect(after.sessions["other-server"]?.queuedMessages).toBe(
      before.sessions["other-server"]?.queuedMessages,
    );
  });

  it("retains one-position arrow moves after drag reordering without changing messages", () => {
    const store = initializeQueues(["a", "b", "c", "d"]);
    store.reorderQueuedAgents("test-server", ["d", "a", "b", "c"]);
    const messages = useSessionStore.getState().sessions["test-server"]?.queuedMessages;

    store.moveQueuedAgent("test-server", "b", -1);
    expect(useSessionStore.getState().sessions["test-server"]?.queuedAgentOrder).toEqual([
      "d",
      "b",
      "a",
      "c",
    ]);

    store.moveQueuedAgent("test-server", "b", 1);
    expect(useSessionStore.getState().sessions["test-server"]?.queuedAgentOrder).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
    expect(useSessionStore.getState().sessions["test-server"]?.queuedMessages).toBe(messages);
  });

  it("retains arrow boundary, missing-conversation, and missing-host no-ops", () => {
    const store = initializeQueues();
    const before = useSessionStore.getState();

    store.moveQueuedAgent("test-server", "a", -1);
    expect(useSessionStore.getState()).toBe(before);
    store.moveQueuedAgent("test-server", "c", 1);
    expect(useSessionStore.getState()).toBe(before);
    store.moveQueuedAgent("test-server", "missing", 1);
    expect(useSessionStore.getState()).toBe(before);
    store.moveQueuedAgent("missing-server", "a", 1);
    expect(useSessionStore.getState()).toBe(before);
  });
});

describe("agent task state", () => {
  it("notifies the task subscriber only when its task snapshot changes", () => {
    initializeTestSession();
    const snapshots: string[][] = [];
    const unsubscribe = useSessionStore.subscribe(
      (state) => state.sessions["test-server"]?.agentTasks.get("agent-1") ?? [],
      (tasks) => snapshots.push(taskTexts(tasks)),
    );

    const tasks = [{ id: "1", text: "Inspect", status: "pending" as const, completed: false }];
    useSessionStore
      .getState()
      .setAgentStreamState("test-server", "agent-1", { taskSnapshot: tasks });
    useSessionStore
      .getState()
      .setAgentStreamState("test-server", "agent-1", { taskSnapshot: [...tasks] });
    useSessionStore.getState().setAgentStreamState("test-server", "agent-1", {
      taskSnapshot: [{ ...tasks[0], status: "completed", completed: true }],
    });
    unsubscribe();

    expect(snapshots).toEqual([["Inspect"], ["Inspect"]]);
  });

  it("restores the latest task snapshot from an authoritative timeline", () => {
    initializeTestSession();
    const todo: StreamItem = {
      kind: "todo_list",
      id: "todo-1",
      provider: "codex",
      timestamp: new Date("2026-08-11T10:00:00.000Z"),
      activity: { type: "started", task: "Verify" },
      items: [{ text: "Verify", status: "in_progress", completed: false }],
    };

    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [todo],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(useSessionStore.getState().sessions["test-server"]?.agentTasks.get("agent-1")).toEqual(
      todo.items,
    );
  });
});

describe("agent timeline state", () => {
  it("commits canonical items, range, and older availability as one synced state", () => {
    initializeTestSession();
    const items: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "canonical-row",
        text: "canonical",
        timestamp: new Date("2026-07-27T10:00:00.000Z"),
      },
    ];

    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items,
      head: [],
      range: { epoch: "epoch-1", startSeq: 51, endSeq: 100 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({
      status: "synced",
      items,
      range: { epoch: "epoch-1", startSeq: 51, endSeq: 100 },
      older: "available",
      newer: "none",
    });
  });

  it("tracks provider history availability independently from painted timeline data", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    const unavailable = {
      reason: "malformed" as const,
      message: "The provider transcript is malformed.",
    };

    store.setAgentStreamTail(
      "test-server",
      new Map([["agent-1", [submittedMessage("cached-message")]]]),
    );
    store.setAgentHistoryUnavailable("test-server", "agent-1", unavailable);

    const unavailableSession = useSessionStore.getState().sessions["test-server"];
    expect(unavailableSession?.agentHistoryUnavailable.get("agent-1")).toEqual(unavailable);
    expect(unavailableSession?.agentStreamTail.get("agent-1")).toHaveLength(1);

    store.setAgentHistoryUnavailable("test-server", "agent-1", null);
    expect(
      useSessionStore.getState().sessions["test-server"]?.agentHistoryUnavailable.has("agent-1"),
    ).toBe(false);
  });

  it("represents an empty authoritative timeline without inventing a range", () => {
    initializeTestSession();
    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({ status: "synced", items: [], range: null, older: "none", newer: "none" });
  });

  it("preserves older availability when an applied response leaves it unchanged", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    store.applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "unchanged",
      newer: false,
      synchronized: false,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({
      status: "synced",
      items: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "available",
      newer: "none",
    });
  });

  it("stores turn liveness transitions without duplicating their policy", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.applyAgentTurnLiveness("test-server", "agent-1", {
      type: "snapshot",
      activeTurn: { turnId: "turn-1", startedAt: null },
    });
    expect(store.getSession("test-server")?.agentTurnLiveness.get("agent-1")).toEqual({
      phase: "open",
      turnId: "turn-1",
      startedAt: null,
      cancellationRequestId: null,
    });

    store.applyAgentTurnLiveness("test-server", "agent-1", {
      type: "snapshot",
      activeTurn: null,
    });
    expect(store.getSession("test-server")?.agentTurnLiveness.has("agent-1")).toBe(false);
  });
});

describe("message submission ordering", () => {
  const agentId = "agent-1";
  const clientMessageId = "client-1";
  const startedAt = new Date("2026-07-31T10:00:01.000Z");
  const steps = [
    "accept",
    "canonical-row",
    "stream-open",
    "snapshot-idle",
    "snapshot-open",
    "stream-close",
  ] as const;

  function applyStep(step: (typeof steps)[number]): void {
    const store = useSessionStore.getState();
    if (step === "accept") {
      store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
      return;
    }
    if (step === "canonical-row") {
      store.setAgentStreamState("test-server", agentId, {
        acknowledgedClientMessageIds: [clientMessageId],
      });
      return;
    }
    if (step === "stream-open") {
      store.applyAgentTurnLiveness("test-server", agentId, {
        type: "stream_open",
        turn: { turnId: "turn-1", startedAt },
      });
      return;
    }
    if (step === "snapshot-open") {
      store.applyAgentTurnLiveness("test-server", agentId, {
        type: "snapshot",
        activeTurn: { turnId: "turn-1", startedAt },
      });
      return;
    }
    if (step === "snapshot-idle") {
      store.applyAgentTurnLiveness("test-server", agentId, {
        type: "snapshot",
        activeTurn: null,
      });
      return;
    }
    store.applyAgentTurnLiveness("test-server", agentId, {
      type: "stream_close",
      turnId: "turn-1",
    });
  }

  it("keeps every ordering active until its canonical row and settles at quiescence", () => {
    const continuityViolations: string[] = [];
    const settlementViolations: string[] = [];

    for (const ordering of permutations(steps)) {
      useSessionStore.getState().clearSession("test-server");
      initializeTestSession();
      useSessionStore
        .getState()
        .beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
      let canonicalObserved = false;

      for (const step of ordering) {
        applyStep(step);
        canonicalObserved ||= step === "canonical-row";
        const presentation = selectAgentTurnPresentation(
          useSessionStore.getState().sessions["test-server"],
          agentId,
        );
        if (!canonicalObserved && !presentation.isActive) {
          continuityViolations.push(`${ordering.join(" → ")}: inactive after ${step}`);
        }
      }

      const store = useSessionStore.getState();
      store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
      store.setAgentStreamState("test-server", agentId, {
        acknowledgedClientMessageIds: [clientMessageId],
      });
      store.applyAgentTurnLiveness("test-server", agentId, [
        { type: "stream_close", turnId: "turn-1" },
        { type: "snapshot", activeTurn: null },
      ]);
      const settled = selectAgentTurnPresentation(
        useSessionStore.getState().sessions["test-server"],
        agentId,
      );
      if (settled.isActive) settlementViolations.push(ordering.join(" → "));
    }

    expect({ continuityViolations, settlementViolations }).toEqual({
      continuityViolations: [],
      settlementViolations: [],
    });
  });

  it("publishes the optimistic row and active presentation in one store notification", () => {
    initializeTestSession();
    const notifications: Array<{ hasOptimisticRow: boolean; isActive: boolean }> = [];
    const unsubscribe = useSessionStore.subscribe((state) => {
      const session = state.sessions["test-server"];
      notifications.push({
        hasOptimisticRow:
          hasSubmittedMessage(session?.agentStreamTail.get(agentId), clientMessageId) === true,
        isActive: selectAgentTurnPresentation(session, agentId).isActive,
      });
    });

    useSessionStore
      .getState()
      .beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
    unsubscribe();

    expect(notifications).toEqual([{ hasOptimisticRow: true, isActive: true }]);
  });

  it("keeps another unacknowledged submission active after one row is acknowledged", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
    store.beginAgentMessageSubmission("test-server", agentId, submittedMessage("client-2"));
    store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
    store.setAgentStreamState("test-server", agentId, {
      acknowledgedClientMessageIds: [clientMessageId],
    });

    expect(
      selectAgentTurnPresentation(useSessionStore.getState().sessions["test-server"], agentId)
        .isActive,
    ).toBe(true);
  });

  it("reconciles a created-agent row without creating a submission transaction", () => {
    initializeTestSession();
    const message = submittedMessage(clientMessageId);

    const handedOff = useSessionStore
      .getState()
      .handoffCreatedAgentUserMessage("test-server", agentId, message);

    const session = useSessionStore.getState().sessions["test-server"];
    expect({
      handedOff,
      tail: session?.agentStreamTail.get(agentId),
      head: session?.agentStreamHead.get(agentId) ?? [],
      submissions: session?.messageSubmissions.get(agentId) ?? [],
    }).toEqual({
      handedOff: true,
      tail: [message],
      head: [],
      submissions: [],
    });
  });
});

describe("normalizeWorkspaceDescriptor", () => {
  it("normalizes workspace scripts and invalid activity timestamps", () => {
    const scripts = [
      {
        scriptName: "web",
        type: "service" as const,
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running" as const,
        health: "healthy" as const,
        exitCode: null,
        terminalId: null,
      },
    ];
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "running",
      statusEnteredAt: null,
      activityAt: "not-a-date",
      diffStat: null,
      scripts,
    });

    expect(workspace.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
    expect(workspace.scripts).not.toBe(scripts);
  });

  it("canonicalizes the workspace directory and treats a blank one as empty", () => {
    const canonical = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo/app/",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(canonical.workspaceDirectory).toBe("/repo/app");

    const blank = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "   ",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(blank.workspaceDirectory).toBe("");
  });

  it("defaults missing scripts to an empty array", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.scripts).toEqual([]);
  });

  it("defaults missing archivingAt to null", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "done",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as unknown as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.archivingAt).toBeNull();
  });

  it("normalizes statusEnteredAt strings to Date and missing or null values to null", () => {
    const basePayload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "running",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } satisfies Omit<WorkspaceDescriptorPayload, "statusEnteredAt" | "archivingAt">;

    const withString = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: "2026-05-12T09:30:00.000Z",
    });
    const withNull = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: null,
    });
    const missing = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
    } as unknown as WorkspaceDescriptorPayload);

    expect(withString.statusEnteredAt).toEqual(new Date("2026-05-12T09:30:00.000Z"));
    expect(withNull.statusEnteredAt).toBeNull();
    expect(missing.statusEnteredAt).toBeNull();
  });

  it("preserves project placement from workspace descriptor payloads", () => {
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "remote:github.com/acme/app",
      projectDisplayName: "acme/app",
      projectRootPath: "/repo/app",
      workspaceDirectory: "/repo/app",
      projectKind: "git",
      workspaceKind: "local_checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
      project: {
        projectKey: "remote:github.com/acme/app",
        projectName: "acme/app",
        checkout: {
          cwd: "/repo/app",
          isGit: true,
          currentBranch: "main",
          remoteUrl: "https://github.com/acme/app.git",
          worktreeRoot: "/repo/app",
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
    });

    expect(workspace.project).toEqual({
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
  });
});

describe("mergeWorkspaces", () => {
  it("preserves scripts on merged workspace entries", () => {
    const store = useSessionStore.getState();
    store.initializeSession("test-server", null as unknown as DaemonClient);
    store.setWorkspaces(
      "test-server",
      new Map([["/repo/main", createWorkspace({ id: "/repo/main", scripts: [] })]]),
    );

    store.mergeWorkspaces("test-server", [
      createWorkspace({
        id: "/repo/main",
        scripts: [
          {
            scriptName: "web",
            type: "service",
            hostname: "web.paseo.localhost",
            port: 3000,
            proxyUrl: "http://web.paseo.localhost:6767",
            lifecycle: "running",
            health: "healthy",
            exitCode: null,
            terminalId: null,
          },
        ],
      }),
    ]);

    expect(store.getSession("test-server")?.workspaces.get("/repo/main")?.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
  });

  it("preserves identity when merging content-equal workspace descriptors", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });

    store.mergeWorkspaces("test-server", [workspace]);
    const first = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, scripts: [...workspace.scripts] }]);
    const second = getTestSessionReferences();

    expect(second.sessions).toBe(first.sessions);
    expect(second.session).toBe(first.session);
    expect(second.workspaces).toBe(first.workspaces);
    expect(second.workspaces.get("/repo/main")).toBe(first.workspaces.get("/repo/main"));
  });

  it("preserves unaffected workspace entry identity when one workspace changes", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspaceA = createWorkspace({ id: "/repo/a", name: "main" });
    const workspaceB = createWorkspace({ id: "/repo/b", name: "feature" });

    store.mergeWorkspaces("test-server", [workspaceA, workspaceB]);
    const before = getTestSessionReferences();
    const beforeA = before.workspaces.get("/repo/a");
    const beforeB = before.workspaces.get("/repo/b");

    store.mergeWorkspaces("test-server", [{ ...workspaceA, status: "running" }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get("/repo/a")).not.toBe(beforeA);
    expect(after.workspaces.get("/repo/b")).toBe(beforeB);
  });

  it("uses incoming null diff stat as authoritative", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({
      id: "/repo/main",
      diffStat: { additions: 2, deletions: 1 },
    });
    store.mergeWorkspaces("test-server", [workspace]);
    const before = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, diffStat: null }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)?.diffStat).toBeNull();
  });
});

describe("setWorkspaces", () => {
  it("preserves identity when replacing workspaces with content-equal entries", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.setWorkspaces(
      "test-server",
      new Map([[workspace.id, { ...workspace, scripts: [...workspace.scripts] }]]),
    );
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)).toBe(before.workspaces.get(workspace.id));
  });
});

describe("file explorer refresh", () => {
  function explorerState(refreshRevision: number): AgentFileExplorerState {
    return {
      directories: new Map(),
      files: new Map(),
      refreshRevision,
      isLoading: false,
      lastError: null,
      pendingRequest: null,
      currentPath: ".",
      history: ["."],
      lastVisitedPath: ".",
      selectedEntryPath: null,
    };
  }

  it("increments only the loaded workspace requested by a completed turn", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.setFileExplorer(
      "test-server",
      new Map([
        ["workspace:a", explorerState(2)],
        ["workspace:b", explorerState(7)],
      ]),
    );

    store.requestFileExplorerRefresh("test-server", "workspace:a");
    store.requestFileExplorerRefresh("test-server", "workspace:missing");

    const fileExplorer = useSessionStore.getState().sessions["test-server"]?.fileExplorer;
    expect(fileExplorer?.get("workspace:a")?.refreshRevision).toBe(3);
    expect(fileExplorer?.get("workspace:b")?.refreshRevision).toBe(7);
    expect(fileExplorer?.has("workspace:missing")).toBe(false);
  });
});

describe("removeWorkspace", () => {
  it("preserves identity when removing a missing workspace", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.removeWorkspace("test-server", "/repo/missing");
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
  });
});

describe("patchWorkspaceScripts", () => {
  it("preserves workspace entry identity when scripts are content-equal", () => {
    const script = {
      scriptName: "web",
      type: "service" as const,
      hostname: "web.paseo.localhost",
      port: 3000,
      proxyUrl: "http://web.paseo.localhost:6767",
      lifecycle: "running" as const,
      health: "healthy" as const,
      exitCode: null,
      terminalId: null,
    };
    const workspace = createWorkspace({ id: "/repo/main", scripts: [script] });
    const current = new Map([[workspace.id, workspace]]);

    const next = patchWorkspaceScripts(current, {
      workspaceId: workspace.id,
      scripts: [{ ...script }],
    });

    expect(next).toBe(current);
    expect(next.get(workspace.id)).toBe(workspace);
  });
});

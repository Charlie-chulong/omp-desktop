import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { deriveDesktopPetTasks } from "./model";

function agent(id: string, overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id,
    serverId: "local",
    serverLabel: "Local",
    provider: "omp",
    title: id,
    status: "idle",
    lastActivityAt: new Date(1000),
    createdAt: new Date(0),
    cwd: "/repo",
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    pendingPermissionCount: 0,
    ...overrides,
  };
}
const connected = new Set(["local"]);

describe("desktop pet task activity", () => {
  it("prioritizes actual permissions, error attention, unread completion and running work", () => {
    const tasks = deriveDesktopPetTasks(
      [
        agent("running", { status: "running", lastActivityAt: new Date(9000) }),
        agent("ready", { status: "running", requiresAttention: true, attentionReason: "finished" }),
        agent("blocked", { status: "running", requiresAttention: true, attentionReason: "error" }),
        agent("permission", {
          status: "running",
          requiresAttention: true,
          attentionReason: "error",
          pendingPermissionCount: 1,
        }),
      ],
      connected,
      "Untitled",
    );
    expect(tasks.map(({ agentId, status }) => [agentId, status])).toEqual([
      ["permission", "needs_input"],
      ["blocked", "blocked"],
      ["ready", "ready"],
      ["running", "running"],
    ]);
  });

  it("clears acknowledged completion and errors, retaining only genuinely running work", () => {
    for (const attentionReason of ["finished", "error", "permission"] as const) {
      const unattended = agent("task", { requiresAttention: true, attentionReason });
      expect(deriveDesktopPetTasks([unattended], connected, "Untitled")).toHaveLength(1);
      expect(
        deriveDesktopPetTasks([{ ...unattended, requiresAttention: false }], connected, "Untitled"),
      ).toEqual([]);
      expect(
        deriveDesktopPetTasks(
          [{ ...unattended, requiresAttention: false, status: "running" }],
          connected,
          "Untitled",
        )[0]?.status,
      ).toBe("running");
    }
  });

  it("retains pending permissions even when attention was acknowledged", () => {
    expect(
      deriveDesktopPetTasks(
        [
          agent("approval", {
            pendingPermissionCount: 1,
            requiresAttention: false,
            attentionReason: null,
          }),
        ],
        connected,
        "Untitled",
      )[0]?.status,
    ).toBe("needs_input");
  });

  it("ignores archived, disconnected and dormant records without inventing completion", () => {
    const agents = [
      agent("archived", { status: "running", archivedAt: new Date(2000) }),
      agent("offline", {
        serverId: "remote",
        requiresAttention: true,
        attentionReason: "permission",
      }),
      agent("dormant"),
      agent("old-error", { status: "error", attentionReason: "error", requiresAttention: false }),
    ];
    expect(deriveDesktopPetTasks(agents, connected, "Untitled")).toEqual([]);
    expect(
      deriveDesktopPetTasks([agent("active", { status: "running" })], new Set(), "Untitled"),
    ).toEqual([]);
  });

  it("preserves host-scoped identities and uses attention recency plus localized untitled text", () => {
    const tasks = deriveDesktopPetTasks(
      [
        agent("same", { title: " ", status: "running" }),
        agent("same", {
          serverId: "remote",
          status: "running",
          attentionTimestamp: new Date(2000),
        }),
      ],
      new Set(["local", "remote"]),
      "未命名任务",
    );
    expect(
      tasks.map(({ serverId, agentId, title, updatedAt }) => ({
        serverId,
        agentId,
        title,
        updatedAt,
      })),
    ).toEqual([
      { serverId: "remote", agentId: "same", title: "same", updatedAt: 2000 },
      { serverId: "local", agentId: "same", title: "未命名任务", updatedAt: 1000 },
    ]);
  });
  it("derives committed directory maps without merging a shared workspace or hiding child permissions", () => {
    const root = {
      ...agent("root", { status: "running", workspaceId: "shared" }),
      pendingPermissions: [],
    };
    const child = {
      ...agent("child", { workspaceId: "shared", pendingPermissionCount: undefined }),
      parentAgentId: "root",
      pendingPermissions: [{}],
    };
    const directory = new Map<string, typeof root | typeof child>([
      ["root", root],
      ["child", child],
    ]);
    const tasks = deriveDesktopPetTasks(
      directory.values(),
      new Set(["remote"]),
      "Untitled",
      "remote",
    );
    expect(tasks.map(({ serverId, agentId, status }) => [serverId, agentId, status])).toEqual([
      ["remote", "child", "needs_input"],
      ["remote", "root", "running"],
    ]);
  });
});

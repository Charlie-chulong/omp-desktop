import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { DesktopPetTask, PetTaskStatus } from "./types";

const PRIORITY: Record<PetTaskStatus, number> = {
  needs_input: 0,
  blocked: 1,
  ready: 2,
  running: 3,
};

export function deriveDesktopPetTasks(
  agents: readonly AggregatedAgent[],
  connectedServerIds: ReadonlySet<string>,
  untitledLabel: string,
): DesktopPetTask[] {
  const tasks: DesktopPetTask[] = [];
  for (const agent of agents) {
    if (agent.archivedAt || !connectedServerIds.has(agent.serverId)) continue;
    let status: PetTaskStatus;
    if (
      (agent.pendingPermissionCount ?? 0) > 0 ||
      (agent.requiresAttention && agent.attentionReason === "permission")
    ) {
      status = "needs_input";
    } else if (agent.requiresAttention && agent.attentionReason === "error") {
      status = "blocked";
    } else if (agent.requiresAttention && agent.attentionReason === "finished") {
      status = "ready";
    } else if (agent.status === "running") {
      status = "running";
    } else {
      continue;
    }
    tasks.push({
      serverId: agent.serverId,
      agentId: agent.id,
      title: agent.title?.trim() || untitledLabel,
      status,
      updatedAt: Math.max(agent.lastActivityAt.getTime(), agent.attentionTimestamp?.getTime() ?? 0),
    });
  }
  return tasks.sort(
    (left, right) =>
      PRIORITY[left.status] - PRIORITY[right.status] ||
      right.updatedAt - left.updatedAt ||
      left.serverId.localeCompare(right.serverId) ||
      left.agentId.localeCompare(right.agentId),
  );
}

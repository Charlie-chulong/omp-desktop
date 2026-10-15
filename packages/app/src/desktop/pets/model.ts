import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { DesktopPetTask, PetTaskStatus } from "./types";

const PRIORITY: Record<PetTaskStatus, number> = {
  needs_input: 0,
  blocked: 1,
  ready: 2,
  running: 3,
};

type PetActivityAgent = Pick<
  AggregatedAgent,
  | "id"
  | "archivedAt"
  | "pendingPermissionCount"
  | "requiresAttention"
  | "attentionReason"
  | "status"
  | "title"
  | "lastActivityAt"
  | "attentionTimestamp"
> & { serverId?: string; pendingPermissions?: readonly unknown[] };

function taskStatus(agent: PetActivityAgent): PetTaskStatus | null {
  if (
    (agent.pendingPermissionCount ?? agent.pendingPermissions?.length ?? 0) > 0 ||
    (agent.requiresAttention && agent.attentionReason === "permission")
  )
    return "needs_input";
  if (agent.requiresAttention && agent.attentionReason === "error") return "blocked";
  if (agent.requiresAttention && agent.attentionReason === "finished") return "ready";
  return agent.status === "running" ? "running" : null;
}

export function deriveDesktopPetTasks(
  agents: Iterable<PetActivityAgent>,
  connectedServerIds: ReadonlySet<string>,
  untitledLabel: string,
  hostServerId?: string,
): DesktopPetTask[] {
  const tasks: DesktopPetTask[] = [];
  for (const agent of agents) {
    const serverId = hostServerId ?? agent.serverId;
    if (!serverId || agent.archivedAt || !connectedServerIds.has(serverId)) continue;
    const status = taskStatus(agent);
    if (!status) continue;
    tasks.push({
      serverId,
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

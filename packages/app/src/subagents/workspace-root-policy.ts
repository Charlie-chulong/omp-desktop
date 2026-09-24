import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

type WorkspaceAgent = { parentAgentId: string | null; workspaceId?: string | null };

export function isWorkspaceRootAgent(
  agent: WorkspaceAgent,
  parentAgent: { workspaceId?: string | null } | undefined,
): boolean {
  if (!agent.parentAgentId) {
    return true;
  }

  const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
  const parentWorkspaceId = normalizeWorkspaceOpaqueId(parentAgent?.workspaceId);
  return Boolean(workspaceId && parentWorkspaceId && workspaceId !== parentWorkspaceId);
}

type PrimaryWorkspaceAgent = WorkspaceAgent & {
  id: string;
  createdAt?: Date | string | null;
  archivedAt?: Date | string | null;
};

/** A workspace owns one primary tab; additional independent roots remain separate conversations. */
export function pickWorkspacePrimaryAgentId(
  agents: readonly PrimaryWorkspaceAgent[],
  workspaceId: string,
): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
  if (!normalizedWorkspaceId) return null;

  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  let primary: PrimaryWorkspaceAgent | null = null;
  let primaryIsActive = false;
  let primaryIsRoot = false;
  let primaryCreatedAt = Infinity;
  for (const agent of agents) {
    if (normalizeWorkspaceOpaqueId(agent.workspaceId) !== normalizedWorkspaceId) continue;
    const active = !agent.archivedAt;
    const root = isWorkspaceRootAgent(
      agent,
      agent.parentAgentId ? byId.get(agent.parentAgentId) : undefined,
    );
    const createdAt =
      agent.createdAt instanceof Date
        ? agent.createdAt.getTime()
        : agent.createdAt
          ? Date.parse(agent.createdAt)
          : Infinity;
    const timestamp = Number.isFinite(createdAt) ? createdAt : Infinity;
    if (
      !primary ||
      (active && !primaryIsActive) ||
      (active === primaryIsActive &&
        ((root && !primaryIsRoot) ||
          (root === primaryIsRoot &&
            (timestamp < primaryCreatedAt ||
              (timestamp === primaryCreatedAt && agent.id < primary.id)))))
    ) {
      primary = agent;
      primaryIsActive = active;
      primaryIsRoot = root;
      primaryCreatedAt = timestamp;
    }
  }
  return primary?.id ?? null;
}

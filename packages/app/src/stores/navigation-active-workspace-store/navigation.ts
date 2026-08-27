import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { pickAttentionAgent } from "@/utils/agent-attention";
import {
  buildHostWorkspaceOpenRoute,
  buildHostWorkspaceRoute,
  decodeWorkspaceIdFromPathSegment,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import {
  normalizeWorkspaceOpaqueId,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { prepareWorkspaceTab, type PrepareWorkspaceTabDeps } from "@/utils/prepare-workspace-tab";

export interface RouteSelectionInput {
  pathname: string;
  params: {
    serverId?: string | string[];
    workspaceId?: string | string[];
  };
}

export interface NavigateToWorkspaceInput {
  serverId: string;
  workspaceId: string;
  target?: WorkspaceTabTarget;
  pin?: boolean;
  // Defer agent-tab preparation until the destination route is active. This avoids
  // inactive retained-workspace effects restoring the previously focused tab.
  deferAgentTargetUntilNavigation?: boolean;
}

export interface NavigateToWorkspaceDeps extends PrepareWorkspaceTabDeps {
  getSessionWorkspaces: (serverId: string) => Map<string, WorkspaceDescriptor> | null | undefined;
  getSessionAgents: (serverId: string) => Iterable<Agent>;
  rememberLastWorkspace: (selection: ActiveWorkspaceSelection) => void;
  navigateToRoute: (route: string) => void;
}

export interface WorkspaceHistoryAgent {
  id: string;
  workspaceId: string | null | undefined;
  parentAgentId: string | null;
}

export interface NavigateToSidebarWorkspaceDeps extends NavigateToWorkspaceDeps {
  getSessionAgentsHydrated: (serverId: string) => boolean;
  fetchWorkspaceAgentHistory: (
    serverId: string,
    workspaceId: string,
  ) => Promise<readonly WorkspaceHistoryAgent[]>;
}

export interface NavigateToLastWorkspaceDeps extends NavigateToWorkspaceDeps {
  getLastWorkspaceSelection: () => ActiveWorkspaceSelection | null;
}

function getParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

function parseWorkspaceSelectionFromRouteParams(params: {
  serverId?: string | string[];
  workspaceId?: string | string[];
}): ActiveWorkspaceSelection | null {
  const serverId = getParamValue(params.serverId);
  const workspaceValue = getParamValue(params.workspaceId);
  const workspaceId = workspaceValue ? decodeWorkspaceIdFromPathSegment(workspaceValue) : null;
  if (!serverId || !workspaceId) {
    return null;
  }
  return { serverId, workspaceId };
}

export function parseActiveWorkspaceSelection(
  input: RouteSelectionInput,
): ActiveWorkspaceSelection | null {
  const routeSelection = parseHostWorkspaceRouteFromPathname(input.pathname);
  if (routeSelection) {
    return routeSelection;
  }

  if (input.pathname !== "/" && input.pathname !== "") {
    return null;
  }

  return parseWorkspaceSelectionFromRouteParams(input.params);
}

export function navigateToWorkspace(
  input: NavigateToWorkspaceInput,
  deps: NavigateToWorkspaceDeps,
): string {
  const workspaces = deps.getSessionWorkspaces(input.serverId);
  const resolvedWorkspaceId = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: input.workspaceId,
  });
  if (input.target) {
    if (
      !input.deferAgentTargetUntilNavigation &&
      (resolvedWorkspaceId || input.target.kind !== "agent")
    ) {
      prepareWorkspaceTab({ ...input, target: input.target }, deps);
    }
  } else {
    const workspaceAgents = resolvedWorkspaceId
      ? Array.from(deps.getSessionAgents(input.serverId)).filter(
          (agent) => normalizeWorkspaceOpaqueId(agent.workspaceId) === resolvedWorkspaceId,
        )
      : [];
    const attentionAgentId = pickAttentionAgent(workspaceAgents);
    if (attentionAgentId && resolvedWorkspaceId) {
      deps.openTab({
        workspaceKey: `${input.serverId}:${resolvedWorkspaceId}`,
        target: { kind: "agent", agentId: attentionAgentId },
        intent: "reveal",
      });
    }
  }

  const route =
    input.target?.kind === "agent" &&
    (!resolvedWorkspaceId || input.deferAgentTargetUntilNavigation)
      ? buildHostWorkspaceOpenRoute(
          input.serverId,
          input.workspaceId,
          `agent:${input.target.agentId}`,
        )
      : buildHostWorkspaceRoute(input.serverId, input.workspaceId);
  deps.rememberLastWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId });
  deps.navigateToRoute(route);
  return route;
}

function pickWorkspaceRootAgentId(
  agents: readonly WorkspaceHistoryAgent[],
  workspaceId: string,
): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
  if (!normalizedWorkspaceId) {
    return null;
  }
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agent of agents) {
    if (normalizeWorkspaceOpaqueId(agent.workspaceId) !== normalizedWorkspaceId) {
      continue;
    }
    if (!agent.parentAgentId) {
      return agent.id;
    }
    const parent = agentsById.get(agent.parentAgentId);
    if (parent && normalizeWorkspaceOpaqueId(parent.workspaceId) !== normalizedWorkspaceId) {
      return agent.id;
    }
  }
  return null;
}

export async function navigateToSidebarWorkspace(
  input: NavigateToWorkspaceInput,
  deps: NavigateToSidebarWorkspaceDeps,
): Promise<string> {
  if (input.target || !deps.getSessionAgentsHydrated(input.serverId)) {
    return navigateToWorkspace(input, deps);
  }

  const workspaces = deps.getSessionWorkspaces(input.serverId);
  const workspaceId =
    resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId: input.workspaceId }) ??
    normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!workspaceId) {
    return navigateToWorkspace(input, deps);
  }

  const hasActiveWorkspaceAgent = Array.from(deps.getSessionAgents(input.serverId)).some(
    (agent) => !agent.archivedAt && normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId,
  );
  if (hasActiveWorkspaceAgent) {
    return navigateToWorkspace(input, deps);
  }

  try {
    const history = await deps.fetchWorkspaceAgentHistory(input.serverId, workspaceId);
    const agentId = pickWorkspaceRootAgentId(history, workspaceId);
    if (agentId) {
      return navigateToWorkspace(
        {
          ...input,
          target: { kind: "agent", agentId },
          pin: true,
          deferAgentTargetUntilNavigation: true,
        },
        deps,
      );
    }
  } catch {
    // History is a best-effort fallback. The workspace itself must remain navigable.
  }

  return navigateToWorkspace(input, deps);
}

export function navigateToLastWorkspace(deps: NavigateToLastWorkspaceDeps): boolean {
  const selection = deps.getLastWorkspaceSelection();
  if (!selection) {
    return false;
  }
  navigateToWorkspace(selection, deps);
  return true;
}

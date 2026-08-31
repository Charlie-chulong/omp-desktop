import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

export function resolveCloseAgentTabPolicy(
  _agent: Pick<Agent, "parentAgentId"> | null | undefined,
): CloseAgentTabPolicy {
  return { kind: "layout-only" };
}

import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy =
  | { kind: "archive-on-close" }
  | { kind: "layout-only"; syncOpenLabel: boolean };

export function resolveCloseAgentTabPolicy(
  agent: Pick<Agent, "parentAgentId"> | null | undefined,
): CloseAgentTabPolicy {
  return { kind: "layout-only", syncOpenLabel: agent != null };
}

/**
 * Shared OMP configuration for daemon end-to-end tests.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: resolve(serverRoot, ".env.test"), override: true });

export interface AgentTestConfig {
  provider: string;
  model?: string;
  thinkingOptionId?: string;
  modes?: {
    full: string; // No permissions required
    ask: string; // Requires permission approval
  };
}

export const agentConfigs = {
  omp: {
    provider: "omp",
    thinkingOptionId: "medium",
    modes: {
      full: "full",
      write: "write",
      ask: "ask",
    },
  },
} as const satisfies Record<string, AgentTestConfig>;

export type AgentProvider = keyof typeof agentConfigs;

/**
 * Get test config for creating an agent with full permissions (no prompts).
 */
export function getFullAccessConfig(provider: AgentProvider = "omp") {
  const config = agentConfigs[provider];
  return {
    provider: config.provider,
    thinkingOptionId: config.thinkingOptionId,
    modeId: config.modes.full,
  };
}

/**
 * Get test config for creating an agent that requires permission approval.
 */
export function getAskModeConfig(provider: AgentProvider = "omp") {
  const config = agentConfigs[provider];
  return {
    provider: config.provider,
    thinkingOptionId: config.thinkingOptionId,
    modeId: config.modes.ask,
  };
}

export const allProviders: AgentProvider[] = ["omp"];

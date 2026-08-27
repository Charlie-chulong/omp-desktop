import type { Logger } from "pino";
import type { AgentClient, AgentProvider, AgentSessionConfig } from "../agent/agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../agent/provider-launch-config.js";
import { OmpAgentClient } from "../agent/providers/omp/agent.js";
import { isCommandAvailable } from "../../executable-resolution/executable-resolution.js";

export const realProviders = ["omp"] as const;
export type RealProvider = (typeof realProviders)[number];
export type RealProviderConfig = Pick<
  AgentSessionConfig,
  "provider" | "model" | "modeId" | "thinkingOptionId"
>;

const availabilityCache = new Map<RealProvider, Promise<boolean>>();

export function getRealProviderConfig(_provider: RealProvider): RealProviderConfig {
  const model = process.env.OMP_REAL_TEST_MODEL?.trim();
  return {
    provider: "omp",
    ...(model ? { model } : {}),
    modeId: "full",
  };
}

export function getRealProviderRuntimeSettings(_provider: RealProvider): ProviderRuntimeSettings {
  return {};
}

export function createRealProviderClient(_provider: RealProvider, logger: Logger): AgentClient {
  return new OmpAgentClient({ logger });
}

export function createRealProviderClients(
  providers: readonly RealProvider[],
  logger: Logger,
): Partial<Record<AgentProvider, AgentClient>> {
  return Object.fromEntries(
    providers.map((provider) => [provider, createRealProviderClient(provider, logger)]),
  );
}

export function canRunRealProvider(provider: RealProvider): Promise<boolean> {
  const cached = availabilityCache.get(provider);
  if (cached) return cached;
  const availability = isCommandAvailable(process.env.OMP_COMMAND ?? "omp");
  availabilityCache.set(provider, availability);
  return availability;
}

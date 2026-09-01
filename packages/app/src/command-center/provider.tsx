import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AgentControlCommandCenterSource } from "./agent-control-registration";
import type { CommandCenterContribution } from "./contributions";
import { createCommandCenterRegistry, type CommandCenterRegistry } from "./registry";

const CommandCenterRegistryContext = createContext<CommandCenterRegistry | null>(null);

export interface ActiveAgentControlSnapshot {
  sourceId: string;
  controls: AgentControlCommandCenterSource;
}

interface ActiveAgentControlOwner {
  sourceId: string;
  token: symbol;
}

interface ActiveAgentControlRegistry {
  getSnapshot(): ActiveAgentControlSnapshot | null;
  subscribe(listener: () => void): () => void;
  replace(owner: ActiveAgentControlOwner, controls: AgentControlCommandCenterSource): void;
  remove(owner: ActiveAgentControlOwner): void;
}

const ActiveAgentControlRegistryContext = createContext<ActiveAgentControlRegistry | null>(null);

function createActiveAgentControlRegistry(): ActiveAgentControlRegistry {
  const registrations = new Map<
    string,
    { owner: ActiveAgentControlOwner; controls: AgentControlCommandCenterSource }
  >();
  const listeners = new Set<() => void>();
  let snapshot: ActiveAgentControlSnapshot | null = null;

  const publish = () => {
    let next: ActiveAgentControlSnapshot | null = null;
    for (const registration of registrations.values()) {
      next = {
        sourceId: registration.owner.sourceId,
        controls: registration.controls,
      };
    }
    if (snapshot?.sourceId === next?.sourceId && snapshot?.controls === next?.controls) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(owner, controls) {
      const current = registrations.get(owner.sourceId);
      if (current?.owner.token === owner.token && current.controls === controls) return;
      registrations.delete(owner.sourceId);
      registrations.set(owner.sourceId, { owner, controls });
      publish();
    },
    remove(owner) {
      const current = registrations.get(owner.sourceId);
      if (current?.owner.token !== owner.token) return;
      registrations.delete(owner.sourceId);
      publish();
    },
  };
}

export function CommandCenterProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<CommandCenterRegistry | null>(null);
  const agentControlRegistryRef = useRef<ActiveAgentControlRegistry | null>(null);
  if (!registryRef.current) registryRef.current = createCommandCenterRegistry();
  if (!agentControlRegistryRef.current) {
    agentControlRegistryRef.current = createActiveAgentControlRegistry();
  }

  return (
    <CommandCenterRegistryContext.Provider value={registryRef.current}>
      <ActiveAgentControlRegistryContext.Provider value={agentControlRegistryRef.current}>
        {children}
      </ActiveAgentControlRegistryContext.Provider>
    </CommandCenterRegistryContext.Provider>
  );
}

function useCommandCenterRegistry(): CommandCenterRegistry {
  const registry = useContext(CommandCenterRegistryContext);
  if (!registry) throw new Error("CommandCenterProvider is required");
  return registry;
}

export function useCommandCenterContributions() {
  const registry = useCommandCenterRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

function useActiveAgentControlRegistry(): ActiveAgentControlRegistry {
  const registry = useContext(ActiveAgentControlRegistryContext);
  if (!registry) throw new Error("CommandCenterProvider is required");
  return registry;
}

export function useActiveAgentControls(): ActiveAgentControlSnapshot | null {
  const registry = useActiveAgentControlRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}

export function useActiveAgentControlRegistration(input: {
  sourceId: string;
  enabled: boolean;
  controls: AgentControlCommandCenterSource;
}): void {
  const registry = useActiveAgentControlRegistry();
  const ownerRef = useRef({ sourceId: input.sourceId, token: Symbol(input.sourceId) });
  if (ownerRef.current.sourceId !== input.sourceId) {
    ownerRef.current = { sourceId: input.sourceId, token: Symbol(input.sourceId) };
  }
  const owner = ownerRef.current;

  useEffect(() => {
    if (!input.enabled) {
      registry.remove(owner);
      return;
    }
    registry.replace(owner, input.controls);
    return () => registry.remove(owner);
  }, [input.controls, input.enabled, owner, registry]);
}

export function useCommandCenterActions(input: {
  sourceId: string;
  enabled: boolean;
  actions: readonly CommandCenterContribution[];
}): void {
  const registry = useCommandCenterRegistry();
  const ownerRef = useRef({ sourceId: input.sourceId, token: Symbol(input.sourceId) });
  if (ownerRef.current.sourceId !== input.sourceId) {
    ownerRef.current = { sourceId: input.sourceId, token: Symbol(input.sourceId) };
  }
  const owner = ownerRef.current;

  useEffect(() => {
    if (!input.enabled) {
      registry.remove(owner);
      return;
    }
    registry.replace({ owner, contributions: input.actions });
    return () => registry.remove(owner);
  }, [input.actions, input.enabled, owner, registry]);
}

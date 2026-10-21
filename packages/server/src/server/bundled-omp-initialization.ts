import type { AgentInitializationPhase } from "@omp-desktop/protocol/messages";

export interface BundledOmpInitializationScope {
  report: (phase: AgentInitializationPhase) => void;
  close: () => void;
}

type InitializationListener = (phase: AgentInitializationPhase | null) => void;

interface ActiveInitialization {
  token: symbol;
  phase: AgentInitializationPhase | null;
}

const activeInitializations = new Map<string, ActiveInitialization>();
const listeners = new Map<string, Set<InitializationListener>>();

function notify(agentId: string, phase: AgentInitializationPhase | null): void {
  const observers = listeners.get(agentId);
  if (!observers) return;
  // New observers replay synchronously; exclude them from this notification.
  const currentObservers = Array.from(observers);
  for (const listener of currentObservers) {
    if (!observers.has(listener)) continue;
    try {
      listener(phase);
    } catch {
      // Progress observers cannot change the outcome of native provisioning.
    }
  }
}

export function beginBundledOmpInitialization(agentId: string): BundledOmpInitializationScope {
  const operation: ActiveInitialization = { token: Symbol(agentId), phase: null };
  activeInitializations.set(agentId, operation);
  return {
    report(phase) {
      if (activeInitializations.get(agentId)?.token !== operation.token) return;
      operation.phase = phase;
      notify(agentId, phase);
    },
    close() {
      if (activeInitializations.get(agentId)?.token !== operation.token) return;
      activeInitializations.delete(agentId);
      notify(agentId, null);
    },
  };
}

export function subscribeBundledOmpInitialization(
  agentId: string,
  listener: InitializationListener,
): () => void {
  let observers = listeners.get(agentId);
  if (!observers) {
    observers = new Set();
    listeners.set(agentId, observers);
  }
  observers.add(listener);
  const phase = activeInitializations.get(agentId)?.phase;
  if (phase) {
    try {
      listener(phase);
    } catch {
      // Replay is subject to the same observer isolation as live progress.
    }
  }
  return () => {
    observers.delete(listener);
    if (observers.size === 0 && listeners.get(agentId) === observers) listeners.delete(agentId);
  };
}

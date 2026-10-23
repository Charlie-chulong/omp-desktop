import type {
  DaemonClient,
  FetchAgentTimelineOptions,
  FetchAgentTimelinePayload,
} from "@omp-desktop/client/internal/daemon-client";
import type { AgentInitializationProgressStatusPayload } from "@omp-desktop/protocol/messages";

type TimelineClient = Pick<DaemonClient, "fetchAgentTimeline">;
type TimelineRequest = FetchAgentTimelineOptions | undefined;
type TimelinePage = FetchAgentTimelinePayload;

const inFlightByClient = new WeakMap<object, Map<string, Promise<TimelinePage>>>();

export function fetchAgentTimelineOnce(
  client: TimelineClient,
  agentId: string,
  request: TimelineRequest,
  onInitializationProgress?: (progress: AgentInitializationProgressStatusPayload) => void,
): Promise<TimelinePage> {
  let inFlight = inFlightByClient.get(client);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByClient.set(client, inFlight);
  }

  const key = `${agentId}:${JSON.stringify(request)}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const fetch = client.fetchAgentTimeline(
    agentId,
    onInitializationProgress ? { ...request, onInitializationProgress } : request,
  );
  inFlight.set(key, fetch);
  const clear = () => {
    if (inFlight.get(key) === fetch) inFlight.delete(key);
  };
  void fetch.then(clear, clear);
  return fetch;
}

import type { AggregateLoadState, AggregatedSchedule } from "@/schedules/aggregated-schedules";

export type SchedulesScreenBodyState =
  | { kind: "loading" }
  | { kind: "load-error" }
  | { kind: "empty" }
  | { kind: "content" };

export function resolveSchedulesScreenBodyState(input: {
  loadState: AggregateLoadState<AggregatedSchedule>;
  showLoadError: boolean;
}): SchedulesScreenBodyState {
  if (input.showLoadError) {
    return { kind: "load-error" };
  }
  // `connecting` means no host is askable yet. Blocking the page on that
  // leaves a spinner if a host never leaves `connecting`/`booting`.
  // Empty CTA is usable immediately; rows appear when a host comes online.
  if (input.loadState.status === "connecting") {
    return { kind: "empty" };
  }
  if (input.loadState.status === "loading") {
    return { kind: "loading" };
  }
  if (input.loadState.data.length === 0) {
    return { kind: "empty" };
  }
  return { kind: "content" };
}

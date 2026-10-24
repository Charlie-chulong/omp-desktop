import type { OmpMonitorScope, OmpMonitorSnapshot } from "./types.js";

/** The isolated view receives only safe preferences and the numeric log projection. */
export interface OmpMonitorViewState {
  language: "zh" | "en";
  compact: boolean;
  pinned: boolean;
  scope: OmpMonitorScope;
  scopes: { profiles: string[]; projects: string[] };
  snapshot: OmpMonitorSnapshot | null;
  workerError: boolean;
  refreshing: boolean;
  windowCount: number;
  maxWindows: number;
}

export type OmpMonitorExportResult = "saved" | "cancelled" | "unavailable" | "failed";

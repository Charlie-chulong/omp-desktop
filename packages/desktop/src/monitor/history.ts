import { calendarDays, measuredPeak } from "./math.js";
import type { MonitorCalendarDay } from "./math.js";
import { emptyUsage } from "./parser.js";
import type { NumericResponse } from "./parser.js";
import type { OmpMonitorCostInput } from "./pricing.js";
import type { OmpMonitorDay, OmpMonitorScope, OmpMonitorUsage } from "./types.js";

const USAGE_FIELDS = Object.keys(emptyUsage()) as Array<keyof OmpMonitorUsage>;
export interface HistoryProjection {
  days: OmpMonitorDay[];
  limited: boolean;
}
interface CachedHistory extends HistoryProjection {
  version: string;
}
interface CachedQuote {
  version: string;
  cost: number | null;
}

function usageContribution(
  field: keyof OmpMonitorUsage,
  response: NumericResponse,
  cost: number | null,
): number {
  if (field === "estimatedCostUsd") return cost ?? 0;
  if (field === "unestimatedRequests") return cost === null ? 1 : 0;
  return response[field];
}

function addUsage(day: OmpMonitorDay, response: NumericResponse, cost: number | null): boolean {
  let limited = false;
  for (const field of USAGE_FIELDS) {
    if (field === "peakOutputTps") continue;
    const sum = day[field] + usageContribution(field, response, cost);
    if (sum > Number.MAX_SAFE_INTEGER) limited = true;
    day[field] = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, sum));
  }
  return limited;
}

function addPeakIntervals(
  response: NumericResponse,
  dates: readonly MonitorCalendarDay[],
  buckets: NumericResponse[][],
): void {
  if (response.startMs === null) return;
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const day = dates[dayIndex]!;
    if (response.endMs > day.start && response.startMs < day.end) buckets[dayIndex]!.push(response);
  }
}

/** Cached current-catalog projections of retained numeric facts, never a persistent ledger. */
export class OmpMonitorHistory {
  private readonly quotes = new WeakMap<NumericResponse, CachedQuote>();
  private readonly histories = new Map<string, CachedHistory>();

  constructor(private readonly estimateCost?: (usage: OmpMonitorCostInput) => number | null) {}

  getDays(
    scope: OmpMonitorScope,
    responses: readonly NumericResponse[],
    now: number,
    revision: number,
    priceVersion: string,
  ): HistoryProjection {
    const dates = calendarDays(now);
    const key = JSON.stringify(scope);
    const version = `${revision}:${dates[0]!.start}:${priceVersion}`;
    const cached = this.histories.get(key);
    if (cached?.version === version) return cached;
    const days = dates.map((day) => ({ date: day.date, ...emptyUsage() }));
    const peakIntervals: NumericResponse[][] = dates.map(() => []);
    let limited = false;
    for (const response of responses) {
      const responseDayIndex = dates.findIndex(
        (day) => response.endMs >= day.start && response.endMs < day.end,
      );
      if (responseDayIndex >= 0)
        limited =
          addUsage(days[responseDayIndex]!, response, this.quoteCost(response, priceVersion)) ||
          limited;
      addPeakIntervals(response, dates, peakIntervals);
    }
    for (let peakDayIndex = 0; peakDayIndex < days.length; peakDayIndex++) {
      const day = dates[peakDayIndex]!;
      days[peakDayIndex]!.peakOutputTps = measuredPeak(
        peakIntervals[peakDayIndex]!,
        day.start,
        day.end,
      );
    }
    const result = { version, days, limited };
    if (this.histories.size >= 9 && !this.histories.has(key))
      this.histories.delete(this.histories.keys().next().value!);
    this.histories.set(key, result);
    return result;
  }

  clear(): void {
    this.histories.clear();
  }

  private quoteCost(response: NumericResponse, version: string): number | null {
    const cached = this.quotes.get(response);
    if (cached?.version === version) return cached.cost;
    const value = this.estimateCost?.(response) ?? null;
    const cost =
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.min(1_000_000_000, value)
        : null;
    this.quotes.set(response, { version, cost });
    return cost;
  }
}

export function currentDayUsage(days: readonly OmpMonitorDay[]): OmpMonitorUsage {
  const today = emptyUsage();
  const current = days.at(-1)!;
  for (const field of USAGE_FIELDS) today[field] = current[field];
  return today;
}

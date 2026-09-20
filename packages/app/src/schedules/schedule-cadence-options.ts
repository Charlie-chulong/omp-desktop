import type { ScheduleCadence } from "@omp-desktop/protocol/schedule/types";
import { everyMsToParts } from "@/utils/schedule-format";

type CronCadence = Extract<ScheduleCadence, { type: "cron" }>;

export interface CadencePresetOption {
  id: string;
  expression: string;
}

export const CUSTOM_CRON_PRESET_ID = "custom";

export const CADENCE_PRESET_OPTIONS: CadencePresetOption[] = [
  { id: "every-minute", expression: "* * * * *" },
  { id: "every-hour", expression: "0 * * * *" },
  { id: "daily-9", expression: "0 9 * * *" },
  { id: "weekdays-9", expression: "0 9 * * 1-5" },
  { id: "mondays-9", expression: "0 9 * * 1" },
];

export function resolveCronPresetId(cadence: CronCadence): string {
  const expression = cadence.expression.trim();
  return (
    CADENCE_PRESET_OPTIONS.find((option) => option.expression === expression)?.id ??
    CUSTOM_CRON_PRESET_ID
  );
}

export function cadencePresetLabelKey(presetId: string): string {
  return `schedules.cadence.presets.${presetId}`;
}

export function normalizeScheduleFormCadence(
  cadence: ScheduleCadence,
  timezone: string,
): CronCadence {
  if (cadence.type === "cron") {
    return { ...cadence, timezone: cadence.timezone ?? timezone };
  }

  return {
    type: "cron",
    expression: everyMsToCronExpression(cadence.everyMs),
    timezone,
  };
}

function everyMsToCronExpression(everyMs: number): string {
  const { value, unit } = everyMsToParts(everyMs);
  if (unit === "minutes") {
    return value === 1 ? "* * * * *" : `*/${Math.min(value, 59)} * * * *`;
  }
  if (unit === "hours") {
    return value === 1 ? "0 * * * *" : `0 */${Math.min(value, 23)} * * *`;
  }
  return value === 1 ? "0 9 * * *" : `0 9 */${Math.min(value, 31)} * *`;
}

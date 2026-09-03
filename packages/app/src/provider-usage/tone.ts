import type { ProviderUsageTone } from "./types";

export function deriveTone(usedPct: number | null | undefined): ProviderUsageTone {
  if (usedPct == null) return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "default";
}

export function deriveRemainingTone(remainingPct: number | null | undefined): ProviderUsageTone {
  if (remainingPct == null) return "default";
  if (remainingPct <= 0) return "danger";
  if (remainingPct <= 30) return "warning";
  return "ok";
}

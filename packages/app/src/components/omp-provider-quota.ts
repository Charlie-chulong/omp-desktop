export function resolveOmpRemainingQuotaPct(usedPct: number | null | undefined): number | null {
  if (typeof usedPct !== "number" || !Number.isFinite(usedPct)) {
    return null;
  }
  const normalizedUsedPct = Math.max(0, Math.min(100, usedPct));
  return 100 - normalizedUsedPct;
}

export function shouldShowOmpFiveHourQuota(planLabel: string | null | undefined): boolean {
  return planLabel?.trim().toLowerCase() !== "pro";
}

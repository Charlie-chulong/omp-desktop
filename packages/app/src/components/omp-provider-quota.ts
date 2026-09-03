export function resolveOmpRemainingQuotaPct(usedPct: number | null | undefined): number | null {
  if (typeof usedPct !== "number" || !Number.isFinite(usedPct)) {
    return null;
  }
  const normalizedUsedPct = Math.max(0, Math.min(100, usedPct));
  return 100 - normalizedUsedPct;
}

export function formatOmpQuotaResetTime(
  iso: string | null | undefined,
  locale: string,
): string | null {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shouldShowOmpFiveHourQuota(planLabel: string | null | undefined): boolean {
  return planLabel?.trim().toLowerCase() !== "pro";
}

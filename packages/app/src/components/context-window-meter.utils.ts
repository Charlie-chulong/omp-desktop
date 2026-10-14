export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}

export function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

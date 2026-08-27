export function normalizeVersionForComparison(version: string | null | undefined): string | null {
  const value = version?.trim();
  return value ? value.replace(/^v/i, "") : null;
}

export function isVersionMismatch(
  appVersion: string | null | undefined,
  daemonVersion: string | null | undefined,
): boolean {
  const app = normalizeVersionForComparison(appVersion);
  const daemon = normalizeVersionForComparison(daemonVersion);
  return Boolean(app && daemon && app !== daemon);
}

export function formatVersionWithPrefix(version: string | null | undefined): string {
  const value = version?.trim();
  if (!value) return "\u2014";
  return value.startsWith("v") ? value : `v${value}`;
}

import type {
  OmpPluginInfo,
  OmpPluginMarketplaceCatalogEntry,
} from "@omp-desktop/protocol/messages";

function parseVersion(version: string) {
  const match =
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
      version,
    );
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  const prerelease = match[4]?.split(".") ?? [];
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0"))
    return null;
  return { core, prerelease };
}

export function hasNewerMarketplaceVersion(installed: string, available: string): boolean {
  const current = parseVersion(installed);
  const next = parseVersion(available);
  if (!current || !next) return false;
  for (let i = 0; i < 3; i++) {
    if (next.core[i] !== current.core[i]) return next.core[i]! > current.core[i]!;
  }
  if (!current.prerelease.length) return false;
  if (!next.prerelease.length) return true;
  for (let i = 0; i < Math.max(current.prerelease.length, next.prerelease.length); i++) {
    const a = current.prerelease[i];
    const b = next.prerelease[i];
    if (a === b) continue;
    if (a === undefined) return true;
    if (b === undefined) return false;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return b.length !== a.length ? b.length > a.length : b > a;
    if (aNumeric !== bNumeric) return aNumeric;
    return b > a;
  }
  return false;
}

export function getMarketplacePluginState(
  entry: OmpPluginMarketplaceCatalogEntry,
  marketplace: string,
  installedPlugins: OmpPluginInfo[],
  scope?: "user" | "project",
) {
  const id = `${entry.name}@${marketplace}`;
  // Disabled project copies do not shadow an enabled user copy.
  const matches = installedPlugins.filter(
    (plugin) => plugin.id === id && (scope === undefined || plugin.scope === scope),
  );
  const installed = scope
    ? matches[0]
    : (matches.find((plugin) => plugin.scope === "project" && plugin.enabled === true) ??
      matches.find((plugin) => plugin.scope === "user" && plugin.enabled === true) ??
      matches.find((plugin) => plugin.scope === "project") ??
      matches[0]);
  return {
    installed,
    updateAvailable:
      !!installed &&
      !!entry.version &&
      hasNewerMarketplaceVersion(installed.version, entry.version),
  };
}

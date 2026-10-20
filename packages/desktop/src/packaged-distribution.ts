import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface PackagedDesktopDistribution {
  privatePlugins: boolean;
  identity: string;
  bundledOmpPath: string | null;
  bundledPluginsPath: string | null;
}

export function readPackagedDesktopDistribution(appRoot: string): PackagedDesktopDistribution {
  const packageInfo: { ompDesktopDistribution?: unknown } = JSON.parse(
    readFileSync(path.join(appRoot, "package.json"), "utf8"),
  );
  const marker = packageInfo.ompDesktopDistribution;
  const privatePlugins = marker === "private-three-plugins";
  if (marker !== undefined && !privatePlugins) {
    throw new Error("Unsupported packaged OMP Desktop distribution marker.");
  }
  const resources = path.dirname(appRoot);
  const ompPath = path.join(resources, "bin", process.platform === "win32" ? "omp.exe" : "omp");
  const bundledOmpPath = existsSync(ompPath) ? ompPath : null;
  if (!privatePlugins) {
    return { privatePlugins: false, identity: "public", bundledOmpPath, bundledPluginsPath: null };
  }
  if (!bundledOmpPath) {
    throw new Error("The private plugin distribution is missing its qualified OMP host.");
  }
  const bundledPluginsPath = path.join(resources, "bundled-omp-plugins");
  const manifest: {
    schemaVersion?: unknown;
    host?: { platform?: unknown; arch?: unknown; sha256?: unknown };
  } = JSON.parse(readFileSync(path.join(bundledPluginsPath, "manifest.json"), "utf8"));
  const host = manifest.host;
  if (
    manifest.schemaVersion !== 1 ||
    host?.platform !== "win32" ||
    host.arch !== "x64" ||
    typeof host.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(host.sha256)
  ) {
    throw new Error("The private plugin distribution has no valid bound-host identity.");
  }
  return {
    privatePlugins: true,
    identity: `private-three-plugins:${host.sha256}`,
    bundledOmpPath,
    bundledPluginsPath,
  };
}

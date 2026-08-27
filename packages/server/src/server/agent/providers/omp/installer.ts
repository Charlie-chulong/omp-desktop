import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import type { OmpInstallationStatus } from "@omp-desktop/protocol/messages";

import { findExecutable } from "../../../../executable-resolution/executable-resolution.js";
import { execCommand } from "../../../../utils/spawn.js";

const OMP_REPOSITORY = "can1357/oh-my-pi";
const RELEASE_API_URL = `https://api.github.com/repos/${OMP_REPOSITORY}/releases/latest`;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

interface GithubRelease {
  tag_name?: unknown;
}

interface LatestOmpRelease {
  tag: string;
  version: string;
}

function parseOmpVersion(value: string): [number, number, number] | null {
  const match = /(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:$|[^\d])/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareOmpVersions(installedVersion: string, latestVersion: string): number | null {
  const installed = parseOmpVersion(installedVersion);
  const latest = parseOmpVersion(latestVersion);
  if (!installed || !latest) return null;
  for (let index = 0; index < installed.length; index += 1) {
    const difference = installed[index]! - latest[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function resolveManagedOmpInstallPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configuredDirectory = env.PI_INSTALL_DIR?.trim();
  if (configuredDirectory) {
    return join(configuredDirectory, platform === "win32" ? "omp.exe" : "omp");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
    return join(localAppData, "omp", "omp.exe");
  }
  return join(home, ".local", "bin", "omp");
}

export function ensureManagedOmpOnPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const installDirectory = dirname(resolveManagedOmpInstallPath(platform, env));
  const pathKey = Object.hasOwn(env, "Path") ? "Path" : "PATH";
  const entries = (env[pathKey] ?? "").split(delimiter).filter(Boolean);
  if (!entries.includes(installDirectory)) {
    env[pathKey] = [installDirectory, ...entries].join(delimiter);
  }
}

function supportedPlatform(platform: NodeJS.Platform, arch: string): boolean {
  if (platform === "darwin" || platform === "linux") {
    return arch === "arm64" || arch === "x64";
  }
  return platform === "win32" && arch === "x64";
}

async function detectLinuxMusl(): Promise<boolean> {
  if (existsSync("/etc/alpine-release")) return true;
  try {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: unknown } }
      | undefined;
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

async function resolveReleaseAssetName(platform: NodeJS.Platform, arch: string): Promise<string> {
  if (platform === "win32") return "omp-windows-x64.exe";
  let target = platform === "darwin" ? "darwin" : "linux";
  if (platform === "linux" && (await detectLinuxMusl())) target = "linux-musl";
  return `omp-${target}-${arch}`;
}

async function readVersion(executablePath: string): Promise<string> {
  const result = await execCommand(executablePath, ["--version"], {
    envMode: "internal",
    timeout: 15_000,
  });
  return result.stdout.trim() || result.stderr.trim();
}

async function fetchLatestOmpRelease(): Promise<LatestOmpRelease> {
  const response = await fetch(RELEASE_API_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "OMP-Desktop" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch the latest OMP release: HTTP ${response.status}`);
  }
  const release = (await response.json()) as GithubRelease;
  if (typeof release.tag_name !== "string" || !release.tag_name.trim()) {
    throw new Error("Latest OMP release did not include a tag name");
  }
  const tag = release.tag_name.trim();
  const parsedVersion = parseOmpVersion(tag);
  if (!parsedVersion) {
    throw new Error(`Latest OMP release has an invalid version tag: ${tag}`);
  }
  return { tag, version: parsedVersion.join(".") };
}

export async function getOmpInstallationStatus(
  options: { checkForUpdates?: boolean } = {},
): Promise<OmpInstallationStatus> {
  ensureManagedOmpOnPath();
  const platform = process.platform;
  const arch = process.arch;
  const installPath = resolveManagedOmpInstallPath();
  const supported = supportedPlatform(process.platform, arch);
  if (!supported) {
    return {
      platform,
      arch,
      supported: false,
      installed: false,
      installPath,
      message: `OMP has no managed binary for ${process.platform}/${arch}`,
    };
  }
  const executablePath =
    (await findExecutable("omp")) ?? (existsSync(installPath) ? installPath : null);
  if (!executablePath) {
    return { platform, arch, supported: true, installed: false, installPath };
  }
  try {
    const version = await readVersion(executablePath);
    const status: OmpInstallationStatus = {
      platform,
      arch,
      supported: true,
      installed: true,
      version,
      installPath: executablePath,
    };
    if (!options.checkForUpdates) return status;

    const latestRelease = await fetchLatestOmpRelease();
    const comparison = compareOmpVersions(version, latestRelease.version);
    if (comparison === null) {
      throw new Error(
        `Unable to compare installed OMP version "${version}" with latest version "${latestRelease.version}"`,
      );
    }
    return {
      ...status,
      latestVersion: latestRelease.version,
      updateAvailable: comparison < 0,
    };
  } catch (error) {
    if (options.checkForUpdates) throw error;
    return {
      platform,
      arch,
      supported: true,
      installed: false,
      installPath: executablePath,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function installOmp(): Promise<OmpInstallationStatus> {
  const status = await getOmpInstallationStatus();
  if (!status.supported) return status;

  const release = await fetchLatestOmpRelease();

  const assetName = await resolveReleaseAssetName(process.platform, process.arch);
  const downloadUrl = `https://github.com/${OMP_REPOSITORY}/releases/download/${release.tag}/${assetName}`;
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Failed to download ${assetName}: HTTP ${response.status}`);
  }

  const installPath = resolveManagedOmpInstallPath();
  const temporaryPath = `${installPath}.${process.pid}.${randomUUID()}.tmp${process.platform === "win32" ? ".exe" : ""}`;
  await fs.mkdir(dirname(installPath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()));
    if (process.platform !== "win32") await fs.chmod(temporaryPath, 0o755);
    await readVersion(temporaryPath);
    await fs.rm(installPath, { force: true });
    await fs.rename(temporaryPath, installPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }

  ensureManagedOmpOnPath();
  const installed = await getOmpInstallationStatus();
  if (!installed.installed) {
    throw new Error(
      installed.message ?? "OMP installation completed but the binary is unavailable",
    );
  }
  return installed;
}

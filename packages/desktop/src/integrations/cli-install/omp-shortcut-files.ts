import { promises as fs } from "node:fs";
import path from "node:path";

const POSIX_SHORTCUT_MARKER = "# Managed by OMP Desktop";
const WINDOWS_SHORTCUT_MARKER = "rem Managed by OMP Desktop";

interface OmpShortcutInput {
  targetPath: string;
  sourcePath: string;
  platform: NodeJS.Platform;
  proxyUrl?: string;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildPosixOmpShortcut(sourcePath: string, proxyUrl?: string): string {
  const proxyLines = proxyUrl
    ? [
        `export PI_PROXY=${quotePosix(proxyUrl)}`,
        'export HTTPS_PROXY="$PI_PROXY"',
        'export HTTP_PROXY="$PI_PROXY"',
      ]
    : [];
  return [
    "#!/bin/sh",
    POSIX_SHORTCUT_MARKER,
    ...proxyLines,
    `exec ${quotePosix(sourcePath)} "$@"`,
    "",
  ].join("\n");
}

export function buildWindowsOmpShortcut(sourcePath: string, proxyUrl?: string): string {
  const escapePercent = (value: string) => value.replaceAll("%", "%%");
  const proxyLines = proxyUrl
    ? [
        `set "PI_PROXY=${escapePercent(proxyUrl)}"`,
        'set "HTTPS_PROXY=%PI_PROXY%"',
        'set "HTTP_PROXY=%PI_PROXY%"',
      ]
    : [];
  return [
    "@echo off",
    WINDOWS_SHORTCUT_MARKER,
    `set "BUNDLED_OMP=${escapePercent(sourcePath)}"`,
    ...proxyLines,
    'if not exist "%BUNDLED_OMP%" (',
    "  echo Bundled OMP executable not found at %BUNDLED_OMP% 1>&2",
    "  exit /b 1",
    ")",
    '"%BUNDLED_OMP%" %*',
    "exit /b %errorlevel%",
  ].join("\r\n");
}

async function isOmpDesktopOwnedShortcut(input: OmpShortcutInput): Promise<boolean> {
  try {
    const stat = await fs.lstat(input.targetPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = await fs.readlink(input.targetPath);
      return (
        path.resolve(path.dirname(input.targetPath), linkTarget) === path.resolve(input.sourcePath)
      );
    }
    if (!stat.isFile()) return false;
    const contents = await fs.readFile(input.targetPath, "utf8");
    const marker = input.platform === "win32" ? WINDOWS_SHORTCUT_MARKER : POSIX_SHORTCUT_MARKER;
    return contents.split(/\r?\n/, 3).includes(marker);
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export async function isManagedOmpShortcut(input: OmpShortcutInput): Promise<boolean> {
  try {
    const stat = await fs.lstat(input.targetPath);
    if (!stat.isFile()) return false;
    const expected =
      input.platform === "win32"
        ? buildWindowsOmpShortcut(input.sourcePath, input.proxyUrl)
        : buildPosixOmpShortcut(input.sourcePath, input.proxyUrl);
    return (await fs.readFile(input.targetPath, "utf8")) === expected;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export async function installOmpShortcutAtPaths(input: OmpShortcutInput): Promise<void> {
  if (await isManagedOmpShortcut(input)) return;
  if (await pathExists(input.targetPath)) {
    if (!(await isOmpDesktopOwnedShortcut(input))) {
      throw new Error(
        `Cannot install the omp shortcut because ${input.targetPath} already exists.`,
      );
    }
    await fs.unlink(input.targetPath);
  }

  await fs.mkdir(path.dirname(input.targetPath), { recursive: true });
  const contents =
    input.platform === "win32"
      ? buildWindowsOmpShortcut(input.sourcePath, input.proxyUrl)
      : buildPosixOmpShortcut(input.sourcePath, input.proxyUrl);
  await fs.writeFile(input.targetPath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o755,
  });
}

export async function uninstallOmpShortcutAtPaths(input: OmpShortcutInput): Promise<void> {
  if (await isOmpDesktopOwnedShortcut(input)) {
    await fs.unlink(input.targetPath);
  }
}

import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type Sha256FileHasher = (file: string) => Promise<string>;
export type BundledOmpHostVerifier = (
  command: string | undefined,
  env?: NodeJS.ProcessEnv,
) => Promise<void>;

export const BUNDLED_OMP_HOST = {
  version: "18.12.3",
  sha256: "4a68fcc76d757bf2c9ce9aeac60d391b80ec1cda1d85b8025759f2e9b4b5c300",
  platform: "win32",
  arch: "x64",
} as const;

export function hasBundledOmpPlugins(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OMP_DESKTOP_BUNDLED_PLUGINS?.trim());
}

export function rejectBundledOmpHostUpdate(env: NodeJS.ProcessEnv = process.env): void {
  if (hasBundledOmpPlugins(env)) {
    throw new Error(
      "This private Desktop distribution uses a plugin-bound OMP host. Generic OMP installation/update is disabled; install a compatible private Desktop package instead. Your plugins and configuration have not been changed.",
    );
  }
}

async function regularFileInfo(file: string): Promise<BigIntStats> {
  const info = await lstat(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Expected a regular file, not a symlink or directory: ${file}`);
  }
  return info;
}

function sameFileInfo(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function changedFile(file: string): Error {
  return new Error(`File changed while computing SHA-256: ${file}`);
}

async function sha256StableFile(file: string, before: BigIntStats): Promise<string> {
  const handle = await open(file, "r");
  try {
    // Bind the bytes to the inspected file, not merely to the pathname that
    // happened to exist before open(). Check both again after consuming it.
    if (!sameFileInfo(before, await handle.stat({ bigint: true }))) throw changedFile(file);
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    if (
      !sameFileInfo(before, await handle.stat({ bigint: true })) ||
      !sameFileInfo(before, await regularFileInfo(file))
    ) {
      throw changedFile(file);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export async function sha256RegularFile(file: string): Promise<string> {
  return sha256StableFile(file, await regularFileInfo(file));
}

/**
 * Process-local content reuse only: every lookup inspects the current file.
 * Callers own this cache's lifetime; no trust is persisted across processes.
 */
export function createSha256FileCache(): Sha256FileHasher {
  const entries = new Map<
    string,
    { info: BigIntStats; pending: Promise<string>; checksum?: string }
  >();
  return async (file) => {
    let info: BigIntStats;
    try {
      info = await regularFileInfo(file);
    } catch (error) {
      entries.delete(file);
      throw error;
    }
    let entry = entries.get(file);
    if (!entry || !sameFileInfo(entry.info, info)) {
      entry = { info, pending: sha256StableFile(file, info) };
      entries.set(file, entry);
    }
    if (entry.checksum !== undefined) return entry.checksum;
    try {
      const checksum = await entry.pending;
      // A concurrent waiter must still see the same file when its hash settles.
      if (!sameFileInfo(entry.info, await regularFileInfo(file))) throw changedFile(file);
      entry.checksum = checksum;
      return checksum;
    } catch (error) {
      if (entries.get(file) === entry) entries.delete(file);
      throw error;
    }
  };
}

/** A fresh verifier is required for every provider launch or management operation. */
export function createBundledOmpHostVerifier(): BundledOmpHostVerifier {
  const hashFile = createSha256FileCache();
  return (command, env = process.env) => verifyBundledOmpHost(command, env, hashFile);
}

/** No cache: replacement between daemon boot and a new session must be detected. */
export async function assertBundledOmpHost(
  command: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return verifyBundledOmpHost(command, env, sha256RegularFile);
}

async function verifyBundledOmpHost(
  command: string | undefined,
  env: NodeJS.ProcessEnv,
  hashFile: Sha256FileHasher,
): Promise<void> {
  if (!hasBundledOmpPlugins(env)) return;
  if (process.platform !== BUNDLED_OMP_HOST.platform || process.arch !== BUNDLED_OMP_HOST.arch) {
    throw new Error("The bundled plugins require the private Windows x64 OMP host.");
  }
  if (!command || !isAbsolute(command)) {
    throw new Error(
      "Bundled plugins require OMP_COMMAND to name the absolute private OMP executable; PATH or command-wrapper fallback is not supported.",
    );
  }
  let checksum: string;
  try {
    checksum = await hashFile(command);
  } catch (error) {
    throw new Error(
      `The plugin-bound OMP host is missing or unreadable at ${command}. Reinstall the private Desktop package.`,
      { cause: error },
    );
  }
  if (checksum !== BUNDLED_OMP_HOST.sha256) {
    throw new Error(
      `The OMP host at ${command} is incompatible with the bundled plugins (SHA-256 mismatch). Reinstall the compatible private Desktop package; stock OMP cannot load these plugins.`,
    );
  }
}

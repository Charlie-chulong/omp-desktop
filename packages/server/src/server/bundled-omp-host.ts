import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";

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

export async function sha256RegularFile(file: string): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Expected a regular file, not a symlink or directory: ${file}`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** No cache: replacement between daemon boot and a new session must be detected. */
export async function assertBundledOmpHost(
  command: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
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
    checksum = await sha256RegularFile(command);
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

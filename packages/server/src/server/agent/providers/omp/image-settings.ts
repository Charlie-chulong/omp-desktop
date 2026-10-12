import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execCommand } from "../../../../utils/spawn.js";
import type { ImageGenerationRuntimeConfig } from "../../../daemon-config-store.js";
import { MIN_SUPPORTED_OMP_VERSION } from "./provider-config.js";

export type OmpImageSettingsGetter = () => ImageGenerationRuntimeConfig | null;
export const OMP_IMAGE_SETTINGS_TOKEN_ENV = "OMP_DESKTOP_IMAGE_SETTINGS_TOKEN";

export function supportsOmpNativeImageSettings(versionOutput: string): boolean {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(versionOutput);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  const minimum = MIN_SUPPORTED_OMP_VERSION.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (version[index] !== minimum[index]) return version[index]! > minimum[index]!;
  }
  return true;
}

/** Register native generate_image even when initially disabled, so later turns can enable it. */
export async function prepareOmpImageSettingsLaunch(
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ configPath: string; token: string; cleanup: () => Promise<void> }> {
  const [binary, ...args] = command;
  if (!binary) throw new Error("OMP image settings require an executable command");
  const version = await execCommand(binary, [...args, "--version"], {
    cwd,
    env,
    envMode: "internal",
  });
  if (!supportsOmpNativeImageSettings(`${version.stdout}\n${version.stderr}`)) {
    throw new Error(
      `Desktop native image settings require OMP v${MIN_SUPPORTED_OMP_VERSION} or newer`,
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "omp-desktop-images-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await chmod(directory, 0o700);
    const configPath = join(directory, "config.yml");
    // No credentials are written into OMP configuration or session history.
    await writeFile(configPath, "generate_image:\n  enabled: true\n", { mode: 0o600 });
    return { configPath, token: randomUUID(), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

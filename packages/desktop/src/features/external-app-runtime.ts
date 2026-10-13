import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import os from "node:os";
import { posix, win32 } from "node:path";

export interface ExternalSpawnedProcess {
  once(event: "error", handler: (error: Error) => void): ExternalSpawnedProcess;
  once(event: "spawn", handler: () => void): ExternalSpawnedProcess;
  unref(): void;
}

export interface ExternalAppRuntime {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;

  pathExists(path: string): boolean;
  resolveCommand(commands: readonly string[]): string | null;
  spawnDetached(input: { command: string; args: readonly string[] }): Promise<void>;
  hasMacApplication(applicationName: string): boolean;
  openMacApplication(input: { applicationName: string; paths: readonly string[] }): Promise<void>;
}

export interface ExternalAppRuntimeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ExternalSpawnedProcess;
  homeDirectory?: string;
}

const RUNTIME_CONTROL_ENV_KEYS = [
  "PASEO_NODE_ENV",
  "PASEO_DESKTOP_MANAGED",
  "PASEO_SUPERVISED",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
] as const;

function createExternalProcessEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  for (const key of RUNTIME_CONTROL_ENV_KEYS) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[key];
    }
  }
  return env;
}

function resolveExecutable(
  commands: readonly string[],
  input: {
    env: NodeJS.ProcessEnv;
    pathExists: (path: string) => boolean;
    platform: NodeJS.Platform;
  },
): string | null {
  for (const command of commands) {
    const absolute =
      input.platform === "win32" ? win32.isAbsolute(command) : posix.isAbsolute(command);
    if (absolute && input.pathExists(command)) {
      return command;
    }

    const pathValue = input.env.PATH ?? input.env.Path ?? input.env.path ?? "";
    const pathDelimiter = input.platform === "win32" ? ";" : ":";
    for (const directory of pathValue.split(pathDelimiter)) {
      if (!directory) continue;
      const candidate = `${directory}/${command}`;
      if (input.platform !== "win32") {
        if (input.pathExists(candidate)) return candidate;
        continue;
      }

      const hasExtension = Boolean(win32.extname(command));
      const extensions = hasExtension ? [""] : [".exe", ".cmd", ".bat", ".com", ""];
      for (const extension of extensions) {
        const windowsCandidate = `${candidate}${extension}`;
        if (input.pathExists(windowsCandidate)) return windowsCandidate;
      }
    }
  }
  return null;
}

function isWindowsCommandScript(executable: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  const extension = win32.extname(executable).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

function escapeWindowsCmdValue(value: string): string {
  const isQuoted = value.startsWith('"') && value.endsWith('"');
  const unquoted = isQuoted ? value.slice(1, -1) : value;
  if (!isQuoted && !/[\s"&|^<>()!]/u.test(unquoted)) return unquoted;

  const quoted = unquoted
    .replace(/(\\*)"/g, (_match, slashes: string) => `${slashes}${slashes}\\"`)
    .replace(/\\+$/u, (slashes) => `${slashes}${slashes}`);
  return `"${quoted}"`;
}

function spawnProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ExternalSpawnedProcess {
  return nodeSpawn(command, args, options) as ChildProcess as ExternalSpawnedProcess;
}

export function createExternalAppRuntime(
  options: ExternalAppRuntimeOptions = {},
): ExternalAppRuntime {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? nodeExistsSync;
  const spawn = options.spawn ?? spawnProcess;
  const homeDirectory = options.homeDirectory ?? os.homedir();

  return {
    platform,
    env,
    pathExists,
    resolveCommand: (commands) => resolveExecutable(commands, { env, pathExists, platform }),
    async spawnDetached({ command, args }) {
      const commandScript = isWindowsCommandScript(command, platform);
      const launchCommand = commandScript ? escapeWindowsCmdValue(command) : command;
      const launchArgs = commandScript ? args.map(escapeWindowsCmdValue) : [...args];
      await new Promise<void>((resolve, reject) => {
        let child: ExternalSpawnedProcess;
        try {
          child = spawn(launchCommand, launchArgs, {
            detached: true,
            env: createExternalProcessEnv(env),
            shell: commandScript,
            stdio: "ignore",
          });
        } catch (error) {
          reject(error);
          return;
        }
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    },
    hasMacApplication(applicationName) {
      if (platform !== "darwin") return false;
      return [
        `/Applications/${applicationName}.app`,
        `${homeDirectory}/Applications/${applicationName}.app`,
        `/System/Applications/${applicationName}.app`,
      ].some(pathExists);
    },
    async openMacApplication({ applicationName, paths }) {
      await this.spawnDetached({
        command: "/usr/bin/open",
        args: ["-a", applicationName, ...paths],
      });
    },
  };
}

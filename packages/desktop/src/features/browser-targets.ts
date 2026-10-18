import { posix, win32 } from "node:path";

import type { ExternalAppRuntime } from "./external-app-runtime.js";

export const BROWSER_TARGET_IDS = [
  "system",
  "chrome",
  "edge",
  "firefox",
  "brave",
  "chromium",
  "safari",
  "custom",
] as const;

export type BrowserTargetId = (typeof BROWSER_TARGET_IDS)[number];

export interface CustomBrowserConfig {
  executable: string;
  args: string[];
}

function validateCustomExecutable(executable: unknown, platform: NodeJS.Platform): void {
  if (typeof executable !== "string" || executable.includes("\0")) {
    throw new Error("Custom browser executable must be an absolute path without NUL characters");
  }
  const absolute =
    platform === "win32"
      ? win32.isAbsolute(executable) &&
        (/^[a-zA-Z]:[\\/]/.test(executable) || /^\\\\[^\\]+\\[^\\]+/.test(executable))
      : posix.isAbsolute(executable);
  if (!absolute) {
    throw new Error("Custom browser executable must be an absolute path");
  }
  if (platform === "win32") {
    const extension = win32.extname(executable).toLowerCase();
    if (extension !== ".exe" && extension !== ".com") {
      throw new Error("Custom browser executable must be a native .exe or .com file on Windows");
    }
  }
}

export function validateCustomBrowserConfig(
  value: unknown,
  platform: NodeJS.Platform = process.platform,
): asserts value is CustomBrowserConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid custom browser configuration");
  }
  const { executable, args } = value as Record<string, unknown>;
  validateCustomExecutable(executable, platform);
  if (!Array.isArray(args)) {
    throw new Error("Custom browser arguments must be an array of strings");
  }
  let placeholders = 0;
  for (const argument of args) {
    if (
      typeof argument !== "string" ||
      argument.includes("\0") ||
      (argument !== "{url}" && argument.includes("{url}"))
    ) {
      throw new Error("Custom browser arguments must not contain embedded {url} or NUL characters");
    }
    if (argument === "{url}") placeholders += 1;
  }
  if (placeholders !== 1) {
    throw new Error("Custom browser arguments must contain exactly one standalone {url}");
  }
}

export interface BrowserTargetDescriptor {
  id: BrowserTargetId;
  label: string;
  available: boolean;
}

interface BrowserTargetDefinition {
  id: Exclude<BrowserTargetId, "system" | "custom">;
  label: string;
  platforms: readonly NodeJS.Platform[];
  macApplication?: string;
}

const BROWSER_TARGETS: readonly BrowserTargetDefinition[] = [
  {
    id: "chrome",
    label: "Google Chrome",
    platforms: ["darwin", "linux", "win32"],
    macApplication: "Google Chrome",
  },
  {
    id: "edge",
    label: "Microsoft Edge",
    platforms: ["darwin", "linux", "win32"],
    macApplication: "Microsoft Edge",
  },
  {
    id: "firefox",
    label: "Firefox",
    platforms: ["darwin", "linux", "win32"],
    macApplication: "Firefox",
  },
  {
    id: "brave",
    label: "Brave",
    platforms: ["darwin", "linux", "win32"],
    macApplication: "Brave Browser",
  },
  {
    id: "chromium",
    label: "Chromium",
    platforms: ["darwin", "linux", "win32"],
    macApplication: "Chromium",
  },
  {
    id: "safari",
    label: "Safari",
    platforms: ["darwin"],
    macApplication: "Safari",
  },
];

export function isBrowserTargetId(value: unknown): value is BrowserTargetId {
  return typeof value === "string" && BROWSER_TARGET_IDS.includes(value as BrowserTargetId);
}

function windowsBrowserPaths(id: BrowserTargetDefinition["id"], env: NodeJS.ProcessEnv): string[] {
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES;
  const programFilesX86 = env["ProgramFiles(x86)"] ?? env["PROGRAMFILES(X86)"];
  const localAppData = env.LOCALAPPDATA;
  const roots = [programFiles, programFilesX86, localAppData].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const relativePaths: Record<BrowserTargetDefinition["id"], string | null> = {
    chrome: "Google/Chrome/Application/chrome.exe",
    edge: "Microsoft/Edge/Application/msedge.exe",
    firefox: "Mozilla Firefox/firefox.exe",
    brave: "BraveSoftware/Brave-Browser/Application/brave.exe",
    chromium: "Chromium/Application/chrome.exe",
    safari: null,
  };
  const relativePath = relativePaths[id];
  return relativePath ? roots.map((root) => `${root}/${relativePath}`) : [];
}

function browserCommands(target: BrowserTargetDefinition, runtime: ExternalAppRuntime): string[] {
  if (runtime.platform === "win32") {
    return windowsBrowserPaths(target.id, runtime.env);
  }
  if (runtime.platform !== "linux") {
    return [];
  }
  switch (target.id) {
    case "chrome":
      return ["google-chrome-stable", "google-chrome", "chrome"];
    case "edge":
      return ["microsoft-edge-stable", "microsoft-edge"];
    case "firefox":
      return ["firefox"];
    case "brave":
      return ["brave-browser", "brave-browser-stable", "brave"];
    case "chromium":
      return ["chromium", "chromium-browser"];
    case "safari":
      return [];
  }
}

async function isBrowserAvailable(
  target: BrowserTargetDefinition,
  runtime: ExternalAppRuntime,
): Promise<boolean> {
  if (!target.platforms.includes(runtime.platform)) {
    return false;
  }
  if (target.macApplication && runtime.hasMacApplication(target.macApplication)) {
    return true;
  }
  return runtime.resolveCommand(browserCommands(target, runtime)) !== null;
}

export async function listBrowserTargets(
  runtime: ExternalAppRuntime,
): Promise<BrowserTargetDescriptor[]> {
  const supportedTargets = BROWSER_TARGETS.filter((target) =>
    target.platforms.includes(runtime.platform),
  );
  const availability = await Promise.all(
    supportedTargets.map((target) => isBrowserAvailable(target, runtime)),
  );
  return [
    { id: "system", label: "System default", available: true },
    ...supportedTargets.map((target, index) => ({
      id: target.id,
      label: target.label,
      available: availability[index] === true,
    })),
    { id: "custom", label: "Custom executable", available: true },
  ];
}

export async function openBrowserTarget(
  id: BrowserTargetId,
  url: string,
  runtime: ExternalAppRuntime,
  openSystemUrl: (url: string) => Promise<void>,
  custom?: CustomBrowserConfig,
): Promise<void> {
  if (id === "system") {
    await openSystemUrl(url);
    return;
  }

  if (id === "custom") {
    validateCustomBrowserConfig(custom, runtime.platform);
    await runtime.spawnDetached({
      command: custom.executable,
      args: custom.args.map((argument) => (argument === "{url}" ? url : argument)),
    });
    return;
  }

  const target = BROWSER_TARGETS.find((candidate) => candidate.id === id);
  if (!target || !target.platforms.includes(runtime.platform)) {
    throw new Error(`Browser is not supported on this platform: ${id}`);
  }

  const command = runtime.resolveCommand(browserCommands(target, runtime));
  if (command) {
    await runtime.spawnDetached({ command, args: [url] });
    return;
  }
  if (target.macApplication && runtime.hasMacApplication(target.macApplication)) {
    await runtime.openMacApplication({ applicationName: target.macApplication, paths: [url] });
    return;
  }
  throw new Error(`${target.label} is not installed`);
}

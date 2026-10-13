import { describe, expect, it, vi } from "vitest";

import { listBrowserTargets, openBrowserTarget } from "./browser-targets";
import type { ExternalAppRuntime } from "./external-app-runtime";

class FakeBrowserRuntime implements ExternalAppRuntime {
  public readonly env: NodeJS.ProcessEnv;
  public readonly launches: Array<{ command: string; args: readonly string[] }> = [];
  public readonly macLaunches: Array<{ applicationName: string; paths: readonly string[] }> = [];
  private readonly installedPaths: Set<string>;
  private readonly macApplications: Set<string>;

  public constructor(
    public readonly platform: NodeJS.Platform,
    options: {
      env?: NodeJS.ProcessEnv;
      installedPaths?: readonly string[];
      macApplications?: readonly string[];
    } = {},
  ) {
    this.env = options.env ?? {};
    this.installedPaths = new Set(options.installedPaths);
    this.macApplications = new Set(options.macApplications);
  }

  public pathExists(targetPath: string): boolean {
    return this.installedPaths.has(targetPath);
  }

  public resolveCommand(commands: readonly string[]): string | null {
    return commands.find((command) => this.installedPaths.has(command)) ?? null;
  }

  public async spawnDetached(input: { command: string; args: readonly string[] }): Promise<void> {
    this.launches.push(input);
  }

  public hasMacApplication(applicationName: string): boolean {
    return this.macApplications.has(applicationName);
  }

  public async openMacApplication(input: {
    applicationName: string;
    paths: readonly string[];
  }): Promise<void> {
    this.macLaunches.push(input);
  }
}

describe("browser targets", () => {
  it("lists platform browsers and marks only installed targets available", async () => {
    const chromePath = "C:/Users/test/AppData/Local/Google/Chrome/Application/chrome.exe";
    const runtime = new FakeBrowserRuntime("win32", {
      env: { LOCALAPPDATA: "C:/Users/test/AppData/Local" },
      installedPaths: [chromePath],
    });

    await expect(listBrowserTargets(runtime)).resolves.toEqual([
      { id: "system", label: "System default", available: true },
      { id: "chrome", label: "Google Chrome", available: true },
      { id: "edge", label: "Microsoft Edge", available: false },
      { id: "firefox", label: "Firefox", available: false },
      { id: "brave", label: "Brave", available: false },
      { id: "chromium", label: "Chromium", available: false },
    ]);
  });

  it("opens a URL with the selected Windows browser instead of the system default", async () => {
    const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    const runtime = new FakeBrowserRuntime("win32", {
      env: { ProgramFiles: "C:/Program Files" },
      installedPaths: [chromePath],
    });
    const openSystemUrl = vi.fn(async () => {});

    await openBrowserTarget("chrome", "https://example.com/a%20b?q=1", runtime, openSystemUrl);

    expect(runtime.launches).toEqual([
      { command: chromePath, args: ["https://example.com/a%20b?q=1"] },
    ]);
    expect(openSystemUrl).not.toHaveBeenCalled();
  });

  it("uses the requested macOS application and preserves the URL", async () => {
    const runtime = new FakeBrowserRuntime("darwin", {
      macApplications: ["Firefox"],
    });

    await openBrowserTarget("firefox", "https://example.com/#section", runtime, vi.fn());

    expect(runtime.macLaunches).toEqual([
      { applicationName: "Firefox", paths: ["https://example.com/#section"] },
    ]);
  });

  it("keeps system-default opening explicit and never falls back after a custom choice", async () => {
    const runtime = new FakeBrowserRuntime("linux");
    const openSystemUrl = vi.fn(async () => {});

    await openBrowserTarget("system", "https://example.com/system", runtime, openSystemUrl);
    await expect(
      openBrowserTarget("firefox", "https://example.com/firefox", runtime, openSystemUrl),
    ).rejects.toThrow("Firefox is not installed");

    expect(openSystemUrl).toHaveBeenCalledTimes(1);
    expect(openSystemUrl).toHaveBeenCalledWith("https://example.com/system");
  });
});

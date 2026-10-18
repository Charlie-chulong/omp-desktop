import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { listBrowserTargets, openBrowserTarget, type CustomBrowserConfig } from "./browser-targets";
import {
  createExternalAppRuntime,
  type ExternalAppRuntime,
  type ExternalSpawnedProcess,
} from "./external-app-runtime";

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
      { id: "custom", label: "Custom executable", available: true },
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

  it.each(["linux", "darwin", "win32"] as const)(
    "offers custom configuration before an executable is configured on %s",
    async (platform) => {
      const targets = await listBrowserTargets(new FakeBrowserRuntime(platform));
      expect(targets).toContainEqual({
        id: "custom",
        label: "Custom executable",
        available: true,
      });
    },
  );

  it.each([
    ["linux", "/opt/My Browser/browser"],
    ["darwin", "/Applications/My Browser.app/Contents/MacOS/browser"],
    ["win32", "C:\\Program Files\\My Browser\\browser.EXE"],
    ["win32", "C:\\Program Files\\My Browser\\browser.CoM"],
  ] as const)(
    "launches custom %s executables through the runtime without a shell",
    async (platform, executable) => {
      const spawn = vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & ExternalSpawnedProcess;
        child.unref = vi.fn();
        queueMicrotask(() => child.emit("spawn"));
        return child;
      });
      const runtime = createExternalAppRuntime({ platform, env: {}, spawn });
      const openSystemUrl = vi.fn(async () => {});
      const url = 'https://example.com/a b?q="quoted"&other=中文#é';
      const args = ["", "--profile", 'profile "one" & 中文', "{url}", "", "--last='two words'"];

      await openBrowserTarget("custom", url, runtime, openSystemUrl, { executable, args });

      expect(spawn).toHaveBeenCalledWith(
        executable,
        ["", "--profile", 'profile "one" & 中文', url, "", "--last='two words'"],
        expect.objectContaining({ shell: false, detached: true, stdio: "ignore" }),
      );
      expect(args).toEqual([
        "",
        "--profile",
        'profile "one" & 中文',
        "{url}",
        "",
        "--last='two words'",
      ]);
      expect(openSystemUrl).not.toHaveBeenCalled();
    },
  );

  it.each([
    { executable: "", args: ["{url}"] },
    { executable: "browser", args: ["{url}"] },
    { executable: "./browser", args: ["{url}"] },
    { executable: "/opt/browser\0", args: ["{url}"] },
    { executable: "/opt/browser", args: [] },
    { executable: "/opt/browser", args: ["{url}", "{url}"] },
    { executable: "/opt/browser", args: ["--url={url}"] },
    { executable: "/opt/browser", args: ["{url}", "prefix{url}suffix"] },
    { executable: "/opt/browser", args: ["{url}", "bad\0argument"] },
    { executable: "/opt/browser", args: ["{url}", 42] },
    { executable: "/opt/browser", args: "{url}" },
    undefined,
  ])("rejects malformed custom configuration before launching: %j", async (custom) => {
    const runtime = new FakeBrowserRuntime("linux");
    const openSystemUrl = vi.fn(async () => {});

    await expect(
      openBrowserTarget(
        "custom",
        "https://example.com",
        runtime,
        openSystemUrl,
        custom as CustomBrowserConfig,
      ),
    ).rejects.toThrow(/custom browser/i);
    expect(runtime.launches).toEqual([]);
    expect(runtime.macLaunches).toEqual([]);
    expect(openSystemUrl).not.toHaveBeenCalled();
  });

  it.each([
    "C:\\browser.cmd",
    "C:\\browser.BAT",
    "C:\\browser.ps1",
    "C:\\browser",
    "C:browser.exe",
    "\\browser.exe",
    "/opt/browser.exe",
  ])("rejects Windows scripts and non-absolute executable paths: %s", async (executable) => {
    const spawn = vi.fn();
    const runtime = createExternalAppRuntime({ platform: "win32", env: {}, spawn });
    const openSystemUrl = vi.fn(async () => {});

    await expect(
      openBrowserTarget("custom", "https://example.com", runtime, openSystemUrl, {
        executable,
        args: ["{url}"],
      }),
    ).rejects.toThrow("Custom browser executable");
    expect(spawn).not.toHaveBeenCalled();
    expect(openSystemUrl).not.toHaveBeenCalled();
  });

  it.each(["throw", "error"] as const)(
    "propagates a custom process %s failure without system fallback",
    async (failure) => {
      const error = new Error("Executable could not be launched");
      const runtime = createExternalAppRuntime({
        platform: "linux",
        env: {},
        spawn: () => {
          if (failure === "throw") throw error;
          const child = new EventEmitter() as EventEmitter & ExternalSpawnedProcess;
          child.unref = vi.fn();
          queueMicrotask(() => child.emit("error", error));
          return child;
        },
      });
      const openSystemUrl = vi.fn(async () => {});

      await expect(
        openBrowserTarget("custom", "https://example.com", runtime, openSystemUrl, {
          executable: "/missing/browser",
          args: ["{url}"],
        }),
      ).rejects.toBe(error);
      expect(openSystemUrl).not.toHaveBeenCalled();
    },
  );
});

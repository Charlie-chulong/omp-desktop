import type * as NodeFs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBundledOmpPath } from "./runtime-paths";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  app: {
    isPackaged: true,
  },
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
}));

vi.mock("electron-log/main", () => ({
  default: { warn: vi.fn() },
}));

vi.mock("@omp-desktop/server", () => ({
  spawnProcess: vi.fn(),
}));

const originalPlatform = process.platform;
const originalExecPath = process.execPath;
const originalResourcesPath = process.resourcesPath;

function setProcessRuntime(input: {
  platform: NodeJS.Platform;
  execPath: string;
  resourcesPath?: string;
}): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: input.platform,
  });
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value: input.execPath,
  });
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: input.resourcesPath,
  });
}

describe("runtime-paths", () => {
  beforeEach(() => {
    mocks.app.isPackaged = true;
    mocks.existsSync.mockReturnValue(true);
    setProcessRuntime({
      platform: "darwin",
      execPath: "/Applications/Paseo.app/Contents/MacOS/Paseo",
      resourcesPath: "/Applications/Paseo.app/Contents/Resources",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setProcessRuntime({
      platform: originalPlatform,
      execPath: originalExecPath,
      resourcesPath: originalResourcesPath,
    });
  });

  it("uses an existing resource runtime and otherwise allows PATH fallback", async () => {
    const fs = await vi.importActual<typeof NodeFs>("node:fs");
    const resourcesPath = fs.mkdtempSync(path.join(tmpdir(), "omp resources 中文 "));
    const executablePath = path.join(
      resourcesPath,
      "bin",
      originalPlatform === "win32" ? "omp.exe" : "omp",
    );
    try {
      setProcessRuntime({
        platform: originalPlatform,
        execPath: originalExecPath,
        resourcesPath,
      });
      mocks.existsSync.mockImplementation(fs.existsSync);
      expect(resolveBundledOmpPath()).toBeNull();

      fs.mkdirSync(path.dirname(executablePath));
      fs.writeFileSync(executablePath, "installed runtime");
      expect(resolveBundledOmpPath()).toBe(executablePath);
    } finally {
      fs.rmSync(resourcesPath, { recursive: true, force: true });
    }
  });

  it("does not resolve a bundled OMP executable during development", () => {
    mocks.app.isPackaged = false;
    expect(resolveBundledOmpPath()).toBeNull();
  });
});

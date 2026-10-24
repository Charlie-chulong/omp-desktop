import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { OmpMonitorController } from "./controller.js";
import type { OmpMonitorScope, OmpMonitorSnapshot } from "./types.js";
import type { OmpMonitorViewState } from "./view-types.js";

type MockWindow = EventEmitter & {
  options: Record<string, unknown>;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  minimized: boolean;
  destroyed: boolean;
  webContents: EventEmitter & {
    id: number;
    mainFrame: object;
    send: Mock;
    setWindowOpenHandler: Mock;
  };
  destroy: () => void;
  getBounds: () => MockWindow["bounds"];
};
type MockWorker = EventEmitter & { postMessage: Mock; terminate: Mock };
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => unknown>(),
  windows: [] as MockWindow[],
  workers: [] as MockWorker[],
  area: { x: 0, y: 0, width: 1920, height: 1040 },
  save: vi.fn(),
  writeFile: vi.fn(),
  csv: vi.fn(),
}));
vi.mock("../window/main-windows.js", () => ({
  isMainWindowSender: (sender: { main?: boolean }) => sender.main === true,
}));
vi.mock("node:fs/promises", () => ({ writeFile: mock.writeFile }));
vi.mock("./csv.js", () => ({ buildMonitorCsv: mock.csv }));
vi.mock("node:worker_threads", async () => {
  // Hoisted module-loading mocks run before static imports initialize.
  const { EventEmitter: Emitter } = await import("node:events");
  class Worker extends Emitter {
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(0);
    constructor(
      public filename: string,
      public options: unknown,
    ) {
      super();
      mock.workers.push(this);
    }
  }
  return { Worker };
});
vi.mock("electron", async () => {
  // Hoisted module-loading mocks run before static imports initialize.
  const { EventEmitter: Emitter } = await import("node:events");
  class Window extends Emitter {
    destroyed = false;
    visible = false;
    minimized = false;
    bounds: typeof mock.area;
    webContents = Object.assign(new Emitter(), {
      id: mock.windows.length + 1,
      mainFrame: {},
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      isDestroyed: () => this.destroyed,
    });
    constructor(public options: Record<string, unknown>) {
      super();
      this.bounds = {
        x: Number(options.x),
        y: Number(options.y),
        width: Number(options.width),
        height: Number(options.height),
      };
      mock.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    isMinimized() {
      return this.minimized;
    }
    show() {
      this.visible = true;
      this.emit("show");
    }
    focus = vi.fn();
    restore() {
      this.minimized = false;
      this.emit("restore");
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.visible = false;
      this.emit("closed");
    }
    close() {
      this.destroy();
    }
    async loadURL() {}
    getBounds() {
      return this.bounds;
    }
    setBounds(value: typeof this.bounds) {
      this.bounds = value;
    }
    setMinimumSize = vi.fn();
    setResizable = vi.fn();
    setAlwaysOnTop = vi.fn();
  }
  return {
    app: { getLocale: () => "zh-CN", getPath: () => "C:/safe-user-data" },
    BrowserWindow: Window,
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) =>
        mock.handlers.set(channel, handler),
      removeHandler: (channel: string) => mock.handlers.delete(channel),
    },
    dialog: { showSaveDialog: mock.save },
    screen: Object.assign(new Emitter(), {
      getPrimaryDisplay: () => ({ workArea: mock.area }),
      getDisplayMatching: () => ({ workArea: mock.area }),
    }),
  };
});

const controllers: OmpMonitorController[] = [];
beforeEach(() => {
  mock.handlers.clear();
  mock.windows.length = 0;
  mock.workers.length = 0;
  mock.area = { x: 0, y: 0, width: 1920, height: 1040 };
  mock.save.mockReset().mockResolvedValue({ canceled: true });
  mock.writeFile.mockReset().mockResolvedValue(undefined);
  mock.csv.mockReset().mockReturnValue("section,value\nrequests,1\n");
});
afterEach(() => {
  for (const instance of controllers) instance.dispose();
  controllers.length = 0;
});
function controller() {
  const instance = new OmpMonitorController({
    roots: [{ path: "C:/isolated-fixture", label: "fixture" }],
  });
  controllers.push(instance);
  instance.initialize();
  return instance;
}
function invoke(
  channel: string,
  window: MockWindow,
  value?: unknown,
  frame = window.webContents.mainFrame,
) {
  const handler = mock.handlers.get("paseo:monitor:" + channel);
  if (!handler) throw new Error("Missing test handler");
  return handler({ sender: window.webContents, senderFrame: frame }, value);
}
function snapshot(scope: OmpMonitorScope = { profile: null, project: null }): OmpMonitorSnapshot {
  const usage = {
    requests: 1,
    failedRequests: 0,
    inputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 10,
    cacheWriteTokens: 0,
    totalTokens: 150,
    costUsd: 0.01,
    unpricedRequests: 0,
    estimatedCostUsd: 0.02,
    unestimatedRequests: 0,
    measuredOutputTokens: 40,
    measuredDurationMs: 1000,
    peakOutputTps: 40,
  };
  const feed = {
    status: "bundled" as const,
    version: "fixture",
    updatedAt: null,
    fetchedAt: null,
    lastAttemptAt: null,
    source: "fixture",
  };
  return {
    updatedAt: 1792843200000,
    scope,
    scopes: { profiles: ["default", "second"], projects: ["A", "B"] },
    resources: {
      status: "unavailable",
      sampledAt: 0,
      processCount: 0,
      cpuPercent: null,
      workingSetBytes: null,
      privateBytes: null,
      reason: "no_processes",
    },
    pricing: {
      networkEnabled: false,
      currency: "USD",
      currencies: ["USD", "CNY"],
      prices: feed,
      rates: feed,
      exchangeRate: 1,
      attribution: null,
    },
    status: "ready",
    rate: { measuredTps: 40, estimatedTps: 0, estimatedShare: 0 },
    today: usage,
    days: [{ ...usage, date: "2026-10-24" }],
    agents: [],
    series: [],
    coverage: {
      roots: [{ label: "fixture", available: true }],
      discoveredFiles: 1,
      readFiles: 1,
      skippedFiles: 0,
      malformedLines: 0,
      limited: false,
      issues: [],
    },
  };
}
function publish(window: MockWindow, value = snapshot(), worker = mock.workers[0]!) {
  worker.emit("message", {
    type: "snapshot",
    scopeId: String(window.webContents.id),
    snapshot: value,
  });
}
function state(window: MockWindow) {
  return invoke("ready", window) as OmpMonitorViewState;
}

describe("native OMP monitor controller", () => {
  it("does no startup scan and shares one collector until the last native window closes", async () => {
    const instance = controller();
    expect(mock.workers).toHaveLength(0);
    expect(mock.windows).toHaveLength(0);
    await instance.open();
    const first = mock.windows[0]!;
    await invoke("new-window", first);
    const second = mock.windows[1]!;
    expect(mock.workers).toHaveLength(1);
    expect(state(first).windowCount).toBe(2);
    invoke("close", first);
    expect(mock.workers[0]!.terminate).not.toHaveBeenCalled();
    expect(state(second).windowCount).toBe(1);
    invoke("close", second);
    expect(mock.workers[0]!.terminate).toHaveBeenCalledOnce();
    await instance.open();
    expect(mock.workers).toHaveLength(2);
    expect(state(mock.windows[2]!).snapshot).toBeNull();
  });

  it("accepts app opening only from its main frame and monitor controls only from exact owned main frames", async () => {
    const instance = controller(),
      mainFrame = {},
      appSender = { main: true, mainFrame };
    const open = mock.handlers.get("paseo:monitor:open")!;
    expect(() => open({ sender: appSender, senderFrame: {} })).toThrow();
    expect(() => open({ sender: { main: false, mainFrame }, senderFrame: mainFrame })).toThrow();
    await open({ sender: appSender, senderFrame: mainFrame });
    const window = mock.windows[0]!;
    expect(() => invoke("refresh", window, undefined, {})).toThrow();
    const ready = mock.handlers.get("paseo:monitor:ready")!;
    expect(() =>
      ready({ sender: { id: window.webContents.id, mainFrame }, senderFrame: mainFrame }),
    ).toThrow();
    instance.dispose();
    expect(mock.handlers.size).toBe(0);
  });

  it("caps independent monitor windows at eight", async () => {
    const instance = controller();
    await instance.open();
    const window = mock.windows[0]!;
    for (let i = 1; i < 8; i++) await invoke("new-window", window);
    await expect(invoke("new-window", window)).rejects.toThrow("limit");
    expect(mock.windows).toHaveLength(8);
    expect(mock.workers).toHaveLength(1);
  });

  it("routes genuine scoped snapshots independently and rejects arbitrary labels and stale scope results", async () => {
    const instance = controller();
    await instance.open();
    const first = mock.windows[0]!;
    await invoke("new-window", first);
    const second = mock.windows[1]!;
    publish(first);
    publish(second);
    expect(() =>
      invoke("scope", first, { profile: null, project: "C:/private/transcript.jsonl" }),
    ).toThrow();
    expect(() => invoke("scope", first, { profile: "x".repeat(161), project: null })).toThrow();
    invoke("scope", first, { profile: "second", project: "A" });
    expect(state(first).snapshot).toBeNull();
    publish(first);
    expect(state(first).snapshot).toBeNull();
    const scoped = snapshot({ profile: "second", project: "A" });
    publish(first, scoped);
    expect(state(first).snapshot).toEqual(scoped);
    expect(state(second).scope).toEqual({ profile: null, project: null });
  });

  it("recovers a failed worker and never accepts results from the terminated worker", async () => {
    const instance = controller();
    await instance.open();
    const window = mock.windows[0]!,
      oldWorker = mock.workers[0]!;
    publish(window);
    oldWorker.emit("error", new Error("private path must never enter a snapshot"));
    expect(state(window).workerError).toBe(true);
    expect(JSON.stringify(state(window))).not.toContain("private path");
    invoke("refresh", window);
    expect(mock.workers).toHaveLength(2);
    publish(window, { ...snapshot(), today: { ...snapshot().today, requests: 99 } }, oldWorker);
    expect(state(window).snapshot?.today.requests).toBe(1);
    publish(window, snapshot(), mock.workers[1]!);
    expect(state(window).workerError).toBe(false);
  });

  it("keeps mode and pin per window, restores dashboard bounds and clamps after display removal", async () => {
    const instance = controller();
    await instance.open();
    const first = mock.windows[0]!;
    await invoke("new-window", first);
    const second = mock.windows[1]!;
    const original = { ...first.getBounds() };
    invoke("compact", first, true);
    invoke("pinned", first, true);
    expect(first.getBounds().width).toBe(356);
    expect(state(first).pinned).toBe(true);
    expect(state(second).compact).toBe(false);
    expect(state(second).pinned).toBe(false);
    invoke("compact", first, false);
    expect(first.getBounds()).toEqual(original);
    mock.area = { x: -1280, y: 0, width: 1280, height: 720 };
    first.emit("restore");
    const restored = first.getBounds();
    expect(restored.x).toBeGreaterThanOrEqual(-1280);
    expect(restored.x + restored.width).toBeLessThanOrEqual(0);
    expect(restored.y + restored.height).toBeLessThanOrEqual(720);
  });

  it("exports only the genuine selected snapshot to a native-dialog path, without exposing the path", async () => {
    const instance = controller();
    await instance.open();
    const window = mock.windows[0]!;
    expect(await invoke("export-csv", window, { path: "untrusted.csv" })).toBe("unavailable");
    const current = snapshot();
    publish(window, current);
    expect(await invoke("export-csv", window)).toBe("cancelled");
    expect(mock.writeFile).not.toHaveBeenCalled();
    mock.save.mockResolvedValue({ canceled: false, filePath: "C:/chosen/monitor.csv" });
    expect(await invoke("export-csv", window, { path: "untrusted.csv", snapshot: {} })).toBe(
      "saved",
    );
    mock.writeFile.mockRejectedValue(new Error("C:/private/failure"));
    expect(await invoke("export-csv", window)).toBe("failed");
  });

  it.each(["unavailable", "error", "scanning"] as const)(
    "does not offer a numeric CSV for a %s source without read facts",
    async (status) => {
      const instance = controller();
      await instance.open();
      const window = mock.windows[0]!;
      const missing = snapshot();
      missing.status = status;
      missing.coverage.readFiles = 0;
      publish(window, missing);
      expect(await invoke("export-csv", window)).toBe("unavailable");
      expect(mock.save).not.toHaveBeenCalled();
    },
  );

  it("validates public-data settings without accepting URLs, models or arbitrary currencies", async () => {
    const instance = controller();
    await instance.open();
    const window = mock.windows[0]!;
    publish(window);
    expect(() => invoke("network-enabled", window, "true")).toThrow();
    expect(() => invoke("currency", window, "https://example.invalid")).toThrow();
    expect(() => invoke("currency", window, "EUR")).toThrow();
    expect(() => invoke("refresh-public-data", window)).toThrow();
  });
});

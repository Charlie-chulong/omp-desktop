import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcMain, Notification } from "electron";
import { registerNotificationHandlers } from "./notifications";

const { instances } = vi.hoisted(() => ({ instances: [] as EventEmitter[] }));
vi.mock("electron", async () => {
  // vi.mock factories run before static imports are initialized.
  const { EventEmitter } = await import("node:events");
  return {
    app: { name: "OMP Desktop" },
    BrowserWindow: {},
    ipcMain: { handle: vi.fn() },
    shell: { openExternal: vi.fn() },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    Notification: class extends EventEmitter {
      static isSupported = () => true;
      constructor() {
        super();
        instances.push(this);
      }
      show() {}
      close() {
        this.emit("close");
      }
    },
  };
});
vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({ get: async () => ({ notifications: { playSound: true } }) }),
}));
vi.mock("../window/main-windows.js", () => ({
  selectMainWindow: vi.fn(),
  showMainWindow: vi.fn(),
}));

let send: (event: unknown, payload: unknown) => Promise<boolean>;
beforeEach(() => {
  vi.useFakeTimers();
  instances.length = 0;
  vi.mocked(ipcMain.handle).mockClear();
  registerNotificationHandlers();
  send = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([name]) => name === "paseo:notification:send")![1];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function startSend() {
  const result = send({ sender: {} }, { title: "Notification test", body: "Delivery" });
  await Promise.resolve();
  return { result, notification: instances[0]! };
}

describe("native notification delivery", () => {
  it("does not report success until the operating system accepts the notification", async () => {
    const { result, notification } = await startSend();
    const settled = vi.fn();
    void result.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    notification.emit("show");
    expect(await result).toBe(true);
    notification.emit("close");
  });

  it("reports asynchronous OS rejection instead of success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, notification } = await startSend();
    notification.emit("failed", {}, "Notifications are not allowed for this application");
    expect(await result).toBe(false);
  });

  it("reports synchronous native delivery failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Notification.prototype, "show").mockImplementation(() => {
      throw new Error("OS rejected delivery");
    });
    expect(await send({ sender: {} }, { title: "Notification test" })).toBe(false);
  });

  it("ends an unacknowledged delivery without leaving the sender waiting forever", async () => {
    const { result, notification } = await startSend();
    const close = vi.spyOn(notification as EventEmitter & { close: () => void }, "close");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(notification.listenerCount("failed")).toBe(0);
  });

  it("reports closure before acknowledgement as undelivered", async () => {
    const { result, notification } = await startSend();
    notification.emit("close");
    expect(await result).toBe(false);
  });
});

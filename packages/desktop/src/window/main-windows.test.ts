import { EventEmitter } from "node:events";
import { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMainWindows,
  getOrCreateMainWindow,
  isMainWindowSender,
  onMainWindowRemoved,
  registerMainWindow,
  selectMainWindow,
} from "./main-windows.js";

vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: vi.fn() } }));

class WindowFixture extends EventEmitter {
  destroyed = false;
  visible = true;
  webContents: Electron.WebContents;
  constructor(id: number) {
    super();
    this.webContents = { id, isDestroyed: () => this.destroyed } as Electron.WebContents;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible;
  }
  close() {
    this.destroyed = true;
    this.emit("closed");
  }
}

const fixtures: WindowFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures) fixture.close();
  fixtures.length = 0;
  vi.clearAllMocks();
});

function windowFixture(id: number) {
  const fixture = new WindowFixture(id);
  fixtures.push(fixture);
  return fixture;
}

describe("main window registry", () => {
  it("never selects a focused companion or treats it as an authenticated activity sender", () => {
    const main = windowFixture(1),
      pet = windowFixture(2);
    registerMainWindow(main as unknown as BrowserWindow);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(pet as unknown as BrowserWindow);
    expect(getMainWindows()).toEqual([main]);
    expect(selectMainWindow(pet.webContents)).toBe(main);
    expect(isMainWindowSender(pet.webContents)).toBe(false);
    expect(isMainWindowSender(main.webContents)).toBe(true);
  });

  it("prefers the real sender, then the focused main window, then visible main windows", () => {
    const first = windowFixture(1),
      second = windowFixture(2);
    first.visible = false;
    registerMainWindow(first as unknown as BrowserWindow);
    registerMainWindow(second as unknown as BrowserWindow);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(second as unknown as BrowserWindow);
    expect(selectMainWindow(first.webContents)).toBe(first);
    expect(selectMainWindow()).toBe(second);
    second.close();
    expect(selectMainWindow()).toBe(first);
  });

  it("removes destroyed main windows and announces the owning sender for snapshot cleanup", () => {
    const main = windowFixture(42);
    const removed = vi.fn();
    const unsubscribe = onMainWindowRemoved(removed);
    registerMainWindow(main as unknown as BrowserWindow);
    main.close();
    expect(getMainWindows()).toEqual([]);
    expect(selectMainWindow()).toBeNull();
    expect(isMainWindowSender(main.webContents)).toBe(false);
    expect(removed).toHaveBeenCalledWith(42);
    unsubscribe();
  });

  it("shares concurrent implicit opens, reopens after close, and keeps explicit extra windows", async () => {
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let nextId = 10;
    const createWindow = async () => {
      await ready;
      const window = windowFixture(nextId++);
      registerMainWindow(window as unknown as BrowserWindow);
      return window as unknown as BrowserWindow;
    };
    const openings = [
      getOrCreateMainWindow(createWindow),
      getOrCreateMainWindow(createWindow),
      getOrCreateMainWindow(createWindow),
    ];
    finish();
    const [first, second, third] = await Promise.all(openings);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(getMainWindows()).toEqual([first]);

    (first as unknown as WindowFixture).close();
    const replacement = await getOrCreateMainWindow(createWindow);
    expect(replacement).not.toBe(first);
    expect(getMainWindows()).toEqual([replacement]);

    const explicit = await createWindow();
    expect(getMainWindows()).toEqual([replacement, explicit]);
    expect(await getOrCreateMainWindow(createWindow)).toBe(replacement);
    expect(getMainWindows()).toEqual([replacement, explicit]);
  });

  it("releases a failed creation so a later launch can create a usable window", async () => {
    const failure = new Error("Window initialization failed");
    await expect(
      getOrCreateMainWindow(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(getMainWindows()).toEqual([]);

    const window = await getOrCreateMainWindow(async () => {
      const replacement = windowFixture(20);
      registerMainWindow(replacement as unknown as BrowserWindow);
      return replacement as unknown as BrowserWindow;
    });
    expect(getMainWindows()).toEqual([window]);
  });
});

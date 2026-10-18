import { EventEmitter } from "node:events";
import { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMainWindows,
  getOrCreateMainWindow,
  isMainWindowSender,
  markMainWindowContentReady,
  markMainWindowLoading,
  onMainWindowRemoved,
  registerMainWindow,
  selectMainWindow,
  showMainWindow,
} from "./main-windows.js";

vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: vi.fn() } }));

class WindowFixture extends EventEmitter {
  destroyed = false;
  visible = true;
  webContents: Electron.WebContents;
  minimized = false;
  rendererDestroyed = false;
  shownCount = 0;
  restoredCount = 0;
  focusedCount = 0;
  constructor(id: number) {
    super();
    this.webContents = {
      id,
      isDestroyed: () => this.destroyed || this.rendererDestroyed,
    } as Electron.WebContents;
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
  restore() {
    this.minimized = false;
    this.restoredCount += 1;
  }
  show() {
    this.visible = true;
    this.shownCount += 1;
  }
  focus() {
    this.focusedCount += 1;
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
  it("keeps pending windows registered without presenting them until content is ready", async () => {
    const fixture = windowFixture(30);
    fixture.visible = false;
    fixture.minimized = true;
    const window = fixture as unknown as BrowserWindow;
    registerMainWindow(window);
    showMainWindow(window);
    expect(getMainWindows()).toEqual([fixture]);
    expect(isMainWindowSender(fixture.webContents)).toBe(true);
    expect(await getOrCreateMainWindow(vi.fn())).toBe(window);
    expect(fixture.shownCount).toBe(0);
    expect(fixture.restoredCount).toBe(0);
    expect(fixture.focusedCount).toBe(0);

    markMainWindowContentReady(window);
    expect(fixture.shownCount).toBe(1);
    expect(fixture.restoredCount).toBe(1);
    expect(fixture.focusedCount).toBe(1);

    fixture.visible = false;
    markMainWindowContentReady(window);
    expect(fixture.visible).toBe(false);
    expect(fixture.focusedCount).toBe(1);
    showMainWindow(window, false);
    expect(fixture.visible).toBe(true);
    expect(fixture.focusedCount).toBe(1);
    showMainWindow(window);
    expect(fixture.focusedCount).toBe(2);
  });

  it("requires new content readiness after loading without hiding visible windows", () => {
    const fixture = windowFixture(36);
    const window = fixture as unknown as BrowserWindow;
    registerMainWindow(window);
    markMainWindowContentReady(window);
    markMainWindowLoading(window);
    expect(fixture.visible).toBe(true);
    expect(getMainWindows()).toEqual([fixture]);

    fixture.visible = false;
    fixture.minimized = true;
    showMainWindow(window);
    expect(fixture.visible).toBe(false);
    expect(fixture.minimized).toBe(true);
    expect(fixture.focusedCount).toBe(1);

    markMainWindowContentReady(window);
    expect(fixture.visible).toBe(true);
    expect(fixture.minimized).toBe(false);
    expect(fixture.shownCount).toBe(1);
    expect(fixture.restoredCount).toBe(1);
    expect(fixture.focusedCount).toBe(2);
    fixture.visible = false;
    markMainWindowContentReady(window);
    expect(fixture.visible).toBe(false);
    expect(fixture.focusedCount).toBe(2);
  });

  it("never presents unregistered, destroyed, or renderer-destroyed windows", () => {
    const unregistered = windowFixture(31);
    const destroyed = windowFixture(32);
    const rendererDestroyed = windowFixture(33);
    registerMainWindow(destroyed as unknown as BrowserWindow);
    registerMainWindow(rendererDestroyed as unknown as BrowserWindow);
    destroyed.close();
    rendererDestroyed.rendererDestroyed = true;
    for (const fixture of [unregistered, destroyed, rendererDestroyed]) {
      const window = fixture as unknown as BrowserWindow;
      markMainWindowContentReady(window);
      showMainWindow(window);
      expect(fixture.shownCount).toBe(0);
      expect(fixture.focusedCount).toBe(0);
    }
  });

  it("permanently disables reveals and late readiness once shutdown begins", async () => {
    vi.resetModules();
    // Shutdown is permanent; load an isolated module instance so this test
    // cannot disable the registry used by the other behavioral tests.
    const registry = await import("./main-windows.js");
    const ready = windowFixture(34);
    const pending = windowFixture(35);
    ready.visible = false;
    pending.visible = false;
    registry.registerMainWindow(ready as unknown as BrowserWindow);
    registry.registerMainWindow(pending as unknown as BrowserWindow);
    registry.markMainWindowContentReady(ready as unknown as BrowserWindow);
    ready.visible = false;
    registry.beginMainWindowShutdown();
    registry.markMainWindowContentReady(pending as unknown as BrowserWindow);
    registry.showMainWindow(ready as unknown as BrowserWindow);
    registry.showMainWindow(pending as unknown as BrowserWindow);
    expect(ready.visible).toBe(false);
    expect(ready.focusedCount).toBe(1);
    expect(pending.visible).toBe(false);
    expect(pending.focusedCount).toBe(0);
  });

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

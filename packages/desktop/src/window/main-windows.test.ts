import { EventEmitter } from "node:events";
import { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMainWindowDocumentVersion,
  getMainWindows,
  getOrCreateMainWindow,
  isMainWindowSender,
  markMainWindowContentReady,
  markMainWindowDocumentLoaded,
  markMainWindowLoading,
  onMainWindowRemoved,
  registerMainWindow,
  selectMainWindow,
  showMainWindow,
} from "./main-windows.js";

vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: vi.fn() } }));
vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

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
    this.webContents = Object.assign(new EventEmitter(), {
      id,
      isDestroyed: () => this.destroyed || this.rendererDestroyed,
    }) as Electron.WebContents;
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
    this.emit("show");
  }
  hide() {
    this.visible = false;
    this.emit("hide");
  }
  focus() {
    this.focusedCount += 1;
  }
  close() {
    this.emit("close", { preventDefault() {} });
    this.destroyed = true;
    this.emit("closed");
  }
}

const fixtures: WindowFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures) fixture.close();
  fixtures.length = 0;
  vi.useRealTimers();
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

  it("presents a pending Windows window only after a successful load and bounded grace period", () => {
    vi.useFakeTimers();
    const fixture = windowFixture(40);
    fixture.visible = false;
    const window = fixture as unknown as BrowserWindow;
    registerMainWindow(window);
    markMainWindowLoading(window);
    vi.advanceTimersByTime(10_000);
    expect(fixture.visible).toBe(false);
    expect(fixture.shownCount).toBe(0);

    markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), "win32");
    vi.advanceTimersByTime(1_999);
    expect(fixture.visible).toBe(false);
    expect(fixture.focusedCount).toBe(0);
    vi.advanceTimersByTime(1);
    expect(fixture.visible).toBe(true);
    expect(fixture.shownCount).toBe(1);
    expect(fixture.focusedCount).toBe(1);

    markMainWindowContentReady(window);
    fixture.hide();
    vi.advanceTimersByTime(10_000);
    expect(fixture.visible).toBe(false);
    expect(fixture.shownCount).toBe(1);
    expect(fixture.focusedCount).toBe(1);
  });

  it("does not postpone the first presentation on duplicate load notifications", () => {
    vi.useFakeTimers();
    const fixture = windowFixture(41);
    fixture.visible = false;
    const window = fixture as unknown as BrowserWindow;
    registerMainWindow(window);
    const documentVersion = getMainWindowDocumentVersion(window);
    markMainWindowDocumentLoaded(window, documentVersion, "win32");
    vi.advanceTimersByTime(1_000);
    markMainWindowDocumentLoaded(window, documentVersion, "win32");
    vi.advanceTimersByTime(1_000);
    expect(fixture.visible).toBe(true);
    expect(fixture.shownCount).toBe(1);
  });

  it.each(["before load", "during the grace period"])(
    "preserves tray hiding when renderer readiness arrives %s",
    (readiness) => {
      vi.useFakeTimers();
      const fixture = windowFixture(43);
      fixture.visible = false;
      const window = fixture as unknown as BrowserWindow;
      registerMainWindow(window);
      if (readiness === "during the grace period") {
        markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), "win32");
        vi.advanceTimersByTime(1_000);
      }
      markMainWindowContentReady(window);
      expect(fixture.visible).toBe(true);
      fixture.hide();
      markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), "win32");
      vi.advanceTimersByTime(10_000);
      expect(fixture.visible).toBe(false);
      expect(fixture.shownCount).toBe(1);

      // Reloading a background window cannot turn it back into an initial show.
      markMainWindowLoading(window);
      markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), "win32");
      vi.advanceTimersByTime(10_000);
      expect(fixture.visible).toBe(false);
      expect(fixture.focusedCount).toBe(1);
    },
  );

  it.each(["close", "hide", "minimize"] as const)(
    "honors an explicit %s while the first presentation is pending",
    (event) => {
      vi.useFakeTimers();
      const fixture = windowFixture(44);
      fixture.visible = false;
      const window = fixture as unknown as BrowserWindow;
      registerMainWindow(window);
      markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), "win32");
      vi.advanceTimersByTime(1_999);
      // A prevented close leaves a live window, just like close-to-tray does.
      fixture.emit(event, { preventDefault() {} });
      vi.advanceTimersByTime(1);
      expect(fixture.destroyed).toBe(false);
      expect(fixture.visible).toBe(false);
      expect(fixture.shownCount).toBe(0);

      markMainWindowLoading(window);
      markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), "win32");
      vi.advanceTimersByTime(10_000);
      expect(fixture.visible).toBe(false);
      expect(fixture.focusedCount).toBe(0);
    },
  );

  it("invalidates the previous document's timer and ignores its late load completion", () => {
    vi.useFakeTimers();
    const fixture = windowFixture(45);
    fixture.visible = false;
    const window = fixture as unknown as BrowserWindow;
    registerMainWindow(window);
    const previousDocument = getMainWindowDocumentVersion(window);
    markMainWindowDocumentLoaded(window, previousDocument, "win32");
    vi.advanceTimersByTime(1_000);
    markMainWindowLoading(window);
    const nextDocument = getMainWindowDocumentVersion(window);
    expect(nextDocument).not.toBe(previousDocument);
    markMainWindowDocumentLoaded(window, previousDocument, "win32");
    vi.advanceTimersByTime(10_000);
    expect(fixture.visible).toBe(false);
    expect(fixture.shownCount).toBe(0);

    markMainWindowDocumentLoaded(window, nextDocument, "win32");
    vi.advanceTimersByTime(1_999);
    expect(fixture.visible).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fixture.visible).toBe(true);
    expect(fixture.shownCount).toBe(1);
  });

  it.each(["window", "renderer"])("never presents after %s destruction", (target) => {
    vi.useFakeTimers();
    const fixture = windowFixture(46);
    fixture.visible = false;
    const window = fixture as unknown as BrowserWindow;
    registerMainWindow(window);
    markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), "win32");
    if (target === "window") {
      fixture.close();
    } else {
      fixture.rendererDestroyed = true;
      fixture.webContents.emit("destroyed");
    }
    vi.advanceTimersByTime(10_000);
    expect(fixture.visible).toBe(false);
    expect(fixture.shownCount).toBe(0);
    expect(fixture.focusedCount).toBe(0);
  });

  it.each(["darwin", "linux"] as const)(
    "keeps %s presentation dependent on the normal renderer readiness path",
    (platform) => {
      vi.useFakeTimers();
      const fixture = windowFixture(47);
      fixture.visible = false;
      const window = fixture as unknown as BrowserWindow;
      registerMainWindow(window);
      markMainWindowDocumentLoaded(window, getMainWindowDocumentVersion(window), platform);
      vi.advanceTimersByTime(10_000);
      expect(fixture.visible).toBe(false);
      expect(fixture.shownCount).toBe(0);
      markMainWindowContentReady(window);
      expect(fixture.visible).toBe(true);
      expect(fixture.shownCount).toBe(1);
    },
  );

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
    vi.useFakeTimers();
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
    registry.markMainWindowDocumentLoaded(
      pending as unknown as BrowserWindow,
      registry.getMainWindowDocumentVersion(pending as unknown as BrowserWindow),
      "win32",
    );
    registry.beginMainWindowShutdown();
    registry.markMainWindowContentReady(pending as unknown as BrowserWindow);
    registry.showMainWindow(ready as unknown as BrowserWindow);
    registry.showMainWindow(pending as unknown as BrowserWindow);
    vi.advanceTimersByTime(10_000);
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

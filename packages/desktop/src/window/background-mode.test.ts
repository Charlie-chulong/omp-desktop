import { describe, expect, it, vi } from "vitest";
import {
  BackgroundModeController,
  type BackgroundModeCloseChoice,
  type BackgroundModeCloseEvent,
  type BackgroundModeWindow,
} from "./background-mode.js";

class FakeWindow implements BackgroundModeWindow {
  visible = true;
  destroyed = false;
  hiddenCount = 0;
  shownCount = 0;
  focusedCount = 0;
  private closeListener: ((event: BackgroundModeCloseEvent) => void) | null = null;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    this.visible = false;
    this.hiddenCount += 1;
  }

  show(): void {
    this.visible = true;
    this.shownCount += 1;
  }

  focus(): void {
    this.focusedCount += 1;
  }

  on(_event: "close", listener: (event: BackgroundModeCloseEvent) => void): void {
    this.closeListener = listener;
  }

  close(): { prevented: boolean } {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    this.closeListener?.(event);
    return event;
  }
}

function createHarness(choice: BackgroundModeCloseChoice) {
  const window = new FakeWindow();
  const quitApp = vi.fn();
  let trayActions: { restore: () => void; quit: () => void } | null = null;
  const promptForCloseChoice = vi.fn().mockResolvedValue(choice);
  const controller = new BackgroundModeController({
    promptForCloseChoice,
    createTray: (actions) => {
      trayActions = actions;
    },
    getWindows: () => [window],
    createWindow: vi.fn().mockResolvedValue(window),
    quitApp,
    onError: (error) => {
      throw error;
    },
  });
  controller.registerWindow(window);
  return {
    controller,
    window,
    quitApp,
    promptForCloseChoice,
    getTrayActions: () => trayActions,
  };
}

describe("background window mode", () => {
  it("creates the tray eagerly and only once", () => {
    const harness = createHarness("background");
    +harness.controller.initializeTray();
    const trayActions = harness.getTrayActions();
    harness.controller.initializeTray();
    +expect(trayActions).not.toBeNull();
    expect(harness.getTrayActions()).toBe(trayActions);
  });

  it("keeps the window alive in the tray and restores it on tray click", async () => {
    const harness = createHarness("background");

    expect(harness.window.close().prevented).toBe(true);
    await vi.waitFor(() => expect(harness.window.hiddenCount).toBe(1));

    const trayActions = harness.getTrayActions();
    expect(trayActions).not.toBeNull();
    trayActions?.restore();
    await vi.waitFor(() => expect(harness.window.shownCount).toBe(1));
    expect(harness.window.focusedCount).toBe(1);
    expect(harness.quitApp).not.toHaveBeenCalled();
  });

  it("quits when the close dialog selects exit", async () => {
    const harness = createHarness("quit");

    expect(harness.window.close().prevented).toBe(true);
    await vi.waitFor(() => expect(harness.quitApp).toHaveBeenCalledOnce());
    expect(harness.window.hiddenCount).toBe(0);
    expect(harness.getTrayActions()).toBeNull();
  });

  it("keeps the window open when the close dialog is dismissed", async () => {
    const harness = createHarness("cancel");

    expect(harness.window.close().prevented).toBe(true);
    await vi.waitFor(() => expect(harness.promptForCloseChoice).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      harness.window.close();
      expect(harness.promptForCloseChoice).toHaveBeenCalledTimes(2);
    });
    expect(harness.quitApp).not.toHaveBeenCalled();
    expect(harness.window.visible).toBe(true);
    expect(harness.getTrayActions()).toBeNull();
  });

  it("quits from the tray menu without reopening the close dialog", async () => {
    const harness = createHarness("background");
    harness.window.close();
    await vi.waitFor(() => expect(harness.getTrayActions()).not.toBeNull());

    harness.getTrayActions()?.quit();
    expect(harness.quitApp).toHaveBeenCalledOnce();
    expect(harness.window.close().prevented).toBe(false);
  });
});

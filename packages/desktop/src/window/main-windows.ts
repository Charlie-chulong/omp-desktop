import { BrowserWindow, type WebContents } from "electron";

const mainWindows = new Set<BrowserWindow>();
const removalListeners = new Set<(senderId: number) => void>();
let mainWindowCreation: Promise<BrowserWindow> | null = null;

export function registerMainWindow(window: BrowserWindow): void {
  mainWindows.add(window);
  const senderId = window.webContents.id;
  window.once("closed", () => {
    mainWindows.delete(window);
    for (const listener of removalListeners) listener(senderId);
  });
}

export function getMainWindows(): BrowserWindow[] {
  return [...mainWindows].filter(
    (window) => !window.isDestroyed() && !window.webContents.isDestroyed(),
  );
}

export function isMainWindowSender(sender: WebContents): boolean {
  return !sender.isDestroyed() && getMainWindows().some((window) => window.webContents === sender);
}

export function selectMainWindow(sender?: WebContents): BrowserWindow | null {
  const windows = getMainWindows();
  const focused = BrowserWindow.getFocusedWindow();
  return (
    windows.find((window) => window.webContents === sender) ??
    windows.find((window) => window === focused) ??
    windows.find((window) => window.isVisible()) ??
    windows[0] ??
    null
  );
}

// Relaunch, tray, pet and activation requests share one creation when no main
// window exists. Explicit New Window/project requests bypass this operation.
export function getOrCreateMainWindow(
  createWindow: () => Promise<BrowserWindow>,
): Promise<BrowserWindow> {
  const existing = selectMainWindow();
  if (existing) return Promise.resolve(existing);
  mainWindowCreation ??= Promise.resolve()
    .then(createWindow)
    .finally(() => {
      mainWindowCreation = null;
    });
  return mainWindowCreation;
}

export function onMainWindowRemoved(listener: (senderId: number) => void): () => void {
  removalListeners.add(listener);
  return () => {
    removalListeners.delete(listener);
  };
}

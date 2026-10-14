import { BrowserWindow, type WebContents } from "electron";

const mainWindows = new Set<BrowserWindow>();
const removalListeners = new Set<(senderId: number) => void>();

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

export function onMainWindowRemoved(listener: (senderId: number) => void): () => void {
  removalListeners.add(listener);
  return () => {
    removalListeners.delete(listener);
  };
}

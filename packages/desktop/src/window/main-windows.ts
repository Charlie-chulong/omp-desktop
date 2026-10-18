import { BrowserWindow, type WebContents } from "electron";

const mainWindows = new Set<BrowserWindow>();
const contentReadyWindows = new WeakSet<BrowserWindow>();
let mainWindowsShuttingDown = false;
const removalListeners = new Set<(senderId: number) => void>();
let mainWindowCreation: Promise<BrowserWindow> | null = null;

export function registerMainWindow(window: BrowserWindow): void {
  mainWindows.add(window);
  contentReadyWindows.delete(window);
  const senderId = window.webContents.id;
  window.once("closed", () => {
    mainWindows.delete(window);
    contentReadyWindows.delete(window);
    for (const listener of removalListeners) listener(senderId);
  });
}

export function markMainWindowLoading(window: BrowserWindow): void {
  contentReadyWindows.delete(window);
}

export function showMainWindow(window: BrowserWindow, focus = true): void {
  if (
    mainWindowsShuttingDown ||
    !mainWindows.has(window) ||
    !contentReadyWindows.has(window) ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return;
  }
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  if (focus) window.focus();
}

export function markMainWindowContentReady(window: BrowserWindow): void {
  if (
    mainWindowsShuttingDown ||
    !mainWindows.has(window) ||
    contentReadyWindows.has(window) ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return;
  }
  contentReadyWindows.add(window);
  showMainWindow(window);
}

export function beginMainWindowShutdown(): void {
  mainWindowsShuttingDown = true;
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

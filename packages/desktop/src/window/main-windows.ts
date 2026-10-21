import { BrowserWindow, type WebContents } from "electron";
import log from "electron-log/main";

const mainWindows = new Set<BrowserWindow>();
const WINDOWS_FIRST_PRESENTATION_DELAY_MS = 2_000;
interface MainWindowState {
  documentVersion: number;
  contentReady: boolean;
  awaitingFirstPresentation: boolean;
  presentationTimer: NodeJS.Timeout | undefined;
}
const mainWindowStates = new WeakMap<BrowserWindow, MainWindowState>();
let mainWindowsShuttingDown = false;
const removalListeners = new Set<(senderId: number) => void>();
let mainWindowCreation: Promise<BrowserWindow> | null = null;

function clearPresentationTimer(state: MainWindowState): void {
  clearTimeout(state.presentationTimer);
  state.presentationTimer = undefined;
}

function finishFirstPresentation(state: MainWindowState): void {
  state.awaitingFirstPresentation = false;
  clearPresentationTimer(state);
}

export function registerMainWindow(window: BrowserWindow): void {
  mainWindows.add(window);
  const state: MainWindowState = {
    documentVersion: 0,
    contentReady: false,
    awaitingFirstPresentation: true,
    presentationTimer: undefined,
  };
  mainWindowStates.set(window, state);
  const stopFirstPresentation = () => finishFirstPresentation(state);
  // An explicit close/hide must win even when it keeps the native window alive
  // in the tray. A later document load must not re-arm its first presentation.
  window.on("show", stopFirstPresentation);
  window.on("hide", stopFirstPresentation);
  window.on("close", stopFirstPresentation);
  window.on("minimize", stopFirstPresentation);
  window.webContents.once("destroyed", stopFirstPresentation);
  const senderId = window.webContents.id;
  window.once("closed", () => {
    finishFirstPresentation(state);
    mainWindows.delete(window);
    mainWindowStates.delete(window);
    for (const listener of removalListeners) listener(senderId);
  });
}

export function markMainWindowLoading(window: BrowserWindow): void {
  const state = mainWindowStates.get(window);
  if (!state) return;
  state.documentVersion += 1;
  state.contentReady = false;
  clearPresentationTimer(state);
}

export function getMainWindowDocumentVersion(window: BrowserWindow): number | undefined {
  return mainWindowStates.get(window)?.documentVersion;
}

export function markMainWindowDocumentLoaded(
  window: BrowserWindow,
  documentVersion: number | undefined,
  platform: NodeJS.Platform = process.platform,
): void {
  const state = mainWindowStates.get(window);
  if (
    platform !== "win32" ||
    mainWindowsShuttingDown ||
    !state ||
    !state.awaitingFirstPresentation ||
    state.contentReady ||
    state.documentVersion !== documentVersion ||
    state.presentationTimer !== undefined ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return;
  }
  // The renderer's content-ready IPC remains the normal path. Only Windows
  // gets a bounded main-process escape hatch after a successful document load.
  state.presentationTimer = setTimeout(() => {
    state.presentationTimer = undefined;
    if (
      mainWindowsShuttingDown ||
      mainWindowStates.get(window) !== state ||
      state.documentVersion !== documentVersion ||
      !state.awaitingFirstPresentation ||
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) {
      return;
    }
    const visibleBefore = window.isVisible();
    markMainWindowContentReady(window);
    log.warn("[window] Windows first-presentation fallback", {
      webContentsId: window.webContents.id,
      documentVersion,
      visibleBefore,
      visibleAfter: window.isVisible(),
    });
  }, WINDOWS_FIRST_PRESENTATION_DELAY_MS);
}

export function showMainWindow(window: BrowserWindow, focus = true): void {
  if (
    mainWindowsShuttingDown ||
    !mainWindows.has(window) ||
    !mainWindowStates.get(window)?.contentReady ||
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
  const state = mainWindowStates.get(window);
  if (
    mainWindowsShuttingDown ||
    !mainWindows.has(window) ||
    !state ||
    state.contentReady ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return;
  }
  finishFirstPresentation(state);
  state.contentReady = true;
  showMainWindow(window);
}

export function beginMainWindowShutdown(): void {
  mainWindowsShuttingDown = true;
  for (const window of mainWindows) {
    const state = mainWindowStates.get(window);
    if (state) finishFirstPresentation(state);
  }
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

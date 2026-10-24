import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  type IpcMainInvokeEvent,
  type Rectangle,
} from "electron";
import { isMainWindowSender } from "../window/main-windows.js";
import { buildMonitorCsv } from "./csv.js";
import type {
  OmpMonitorRoot,
  OmpMonitorScope,
  OmpMonitorSnapshot,
  OmpMonitorWorkerRequest,
  OmpMonitorWorkerResponse,
} from "./types.js";
import type { OmpMonitorExportResult, OmpMonitorViewState } from "./view-types.js";

const MONITOR_URL = "omp-desktop://monitor/local-monitor";
const MAX_WINDOWS = 8;
const COMPACT_SIZE = { width: 356, height: 242 };
const DASHBOARD_SIZE = { width: 940, height: 760 };
// Numeric snapshots are always cloned; this channel never transfers ownership of buffers.
const NO_TRANSFERABLES: [] = [];

interface MonitorWindow {
  window: BrowserWindow;
  scope: OmpMonitorScope;
  compact: boolean;
  pinned: boolean;
  snapshot: OmpMonitorSnapshot | null;
  workerError: boolean;
  refreshing: boolean;
  exporting: boolean;
  dashboardBounds: Rectangle;
  compactBounds: Rectangle | null;
}

export class OmpMonitorController {
  private readonly windows = new Map<string, MonitorWindow>();
  private readonly handlers: string[] = [];
  private worker: Worker | null = null;
  private initialized = false;
  private disposed = false;
  private opening: Promise<void> | null = null;
  private scopes: OmpMonitorSnapshot["scopes"] = { profiles: [], projects: [] };

  constructor(private readonly options: { roots?: OmpMonitorRoot[] } = {}) {}

  initialize(): void {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    ipcMain.handle("paseo:monitor:open", (event) => {
      if (!isMainWindowSender(event.sender) || event.senderFrame !== event.sender.mainFrame)
        throw new Error("Monitor opening requires a main application window");
      return this.open();
    });
    this.handlers.push("paseo:monitor:open");
    const handle = (
      channel: string,
      callback: (view: MonitorWindow, value: unknown) => unknown,
    ) => {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, value: unknown) => {
        const view = this.windows.get(String(event.sender.id));
        if (
          !view ||
          view.window.isDestroyed() ||
          event.sender !== view.window.webContents ||
          event.senderFrame !== view.window.webContents.mainFrame
        )
          throw new Error("Unauthorized monitor sender");
        return callback(view, value);
      });
      this.handlers.push(channel);
    };
    handle("paseo:monitor:ready", (view) => this.viewState(view));
    handle("paseo:monitor:refresh", () => {
      for (const view of this.windows.values()) {
        view.refreshing = true;
        view.workerError = false;
      }
      this.startWorker();
      this.post({ type: "refresh" });
      this.sendStates();
    });
    handle("paseo:monitor:compact", (view, value) => {
      if (typeof value !== "boolean") throw new Error("Invalid monitor mode");
      this.setCompact(view, value);
    });
    handle("paseo:monitor:pinned", (view, value) => {
      if (typeof value !== "boolean") throw new Error("Invalid monitor pin state");
      view.pinned = value;
      view.window.setAlwaysOnTop(value);
      this.sendState(view);
    });
    handle("paseo:monitor:scope", (view, value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid monitor scope");
      const candidate = value as Record<string, unknown>;
      const profile = candidate.profile,
        project = candidate.project;
      if (
        (profile !== null &&
          (typeof profile !== "string" ||
            profile.length > 160 ||
            !this.scopes.profiles.includes(profile))) ||
        (project !== null &&
          (typeof project !== "string" ||
            project.length > 160 ||
            !this.scopes.projects.includes(project)))
      )
        throw new Error("Unknown monitor scope");
      if (profile === view.scope.profile && project === view.scope.project) return;
      view.scope = { profile, project } as OmpMonitorScope;
      view.snapshot = null;
      view.refreshing = true;
      this.startWorker();
      this.postScopes();
      this.sendState(view);
    });
    handle("paseo:monitor:new-window", (view) => this.createWindow({ ...view.scope }));
    handle("paseo:monitor:export-csv", (view) => this.exportCsv(view));
    handle("paseo:monitor:network-enabled", (_view, value) => {
      if (typeof value !== "boolean") throw new Error("Invalid public-data setting");
      this.startWorker();
      this.post({ type: "pricing.configure", networkEnabled: value });
    });
    handle("paseo:monitor:currency", (view, value) => {
      if (
        typeof value !== "string" ||
        !/^[A-Z]{3}$/.test(value) ||
        !view.snapshot?.pricing.currencies.includes(value)
      )
        throw new Error("Unsupported monitor currency");
      this.startWorker();
      this.post({ type: "pricing.configure", currency: value });
    });
    handle("paseo:monitor:refresh-public-data", (view) => {
      if (!view.snapshot?.pricing.networkEnabled)
        throw new Error("Public-data updates are disabled");
      this.startWorker();
      this.post({ type: "pricing.refresh" });
    });
    handle("paseo:monitor:close", (view) => view.window.close());
    screen.on("display-added", this.onDisplaysChanged);
    screen.on("display-removed", this.onDisplaysChanged);
    screen.on("display-metrics-changed", this.onDisplaysChanged);
  }

  async open(): Promise<void> {
    if (this.disposed) return;
    this.initialize();
    if (this.opening) return this.opening;
    const existing = this.windows.values().next().value as MonitorWindow | undefined;
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore();
      this.clampWindow(existing);
      existing.window.show();
      existing.window.focus();
      return;
    }
    const pending = this.createWindow({ profile: null, project: null });
    this.opening = pending;
    try {
      await pending;
    } finally {
      if (this.opening === pending) this.opening = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const channel of this.handlers) ipcMain.removeHandler(channel);
    this.handlers.length = 0;
    if (this.initialized) {
      screen.removeListener("display-added", this.onDisplaysChanged);
      screen.removeListener("display-removed", this.onDisplaysChanged);
      screen.removeListener("display-metrics-changed", this.onDisplaysChanged);
    }
    this.stopWorker();
    for (const view of this.windows.values()) {
      if (!view.window.isDestroyed()) view.window.destroy();
    }
    this.windows.clear();
  }

  private async createWindow(scope: OmpMonitorScope): Promise<void> {
    if (this.disposed) return;
    if (this.windows.size >= MAX_WINDOWS) throw new Error("Monitor window limit reached");
    const area = screen.getPrimaryDisplay().workArea;
    const offset = this.windows.size * 24;
    const bounds = this.clampBounds({
      ...DASHBOARD_SIZE,
      x: area.x + Math.round((area.width - DASHBOARD_SIZE.width) / 2) + offset,
      y: area.y + Math.round((area.height - DASHBOARD_SIZE.height) / 2) + offset,
    });
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: false,
      title: "OMP Local Monitor",
      backgroundColor: "#10131d",
      hasShadow: true,
      minWidth: Math.min(720, area.width),
      minHeight: Math.min(540, area.height),
      resizable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    const id = String(window.webContents.id);
    const view: MonitorWindow = {
      window,
      scope,
      compact: false,
      pinned: false,
      snapshot: null,
      workerError: false,
      refreshing: true,
      exporting: false,
      dashboardBounds: bounds,
      compactBounds: null,
    };
    this.windows.set(id, view);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.on("show", this.updateVisibility);
    window.on("hide", this.updateVisibility);
    window.on("minimize", this.updateVisibility);
    window.on("restore", () => {
      this.clampWindow(view);
      this.updateVisibility();
    });
    window.on("closed", () => {
      if (this.windows.get(id) !== view) return;
      this.windows.delete(id);
      if (!this.windows.size) {
        this.stopWorker();
        this.scopes = { profiles: [], projects: [] };
      } else {
        this.postScopes();
        this.updateVisibility();
        this.sendStates();
      }
    });
    this.startWorker();
    this.postScopes();
    this.sendStates();
    try {
      await window.loadURL(MONITOR_URL);
      if (this.disposed || window.isDestroyed() || this.windows.get(id) !== view) return;
      window.show();
      window.focus();
      this.updateVisibility();
      this.sendState(view);
    } catch {
      if (!window.isDestroyed()) window.destroy();
      throw new Error("Unable to open the local monitor");
    }
  }

  private startWorker(): void {
    if (this.worker || this.disposed || !this.windows.size) return;
    let worker: Worker;
    try {
      worker = new Worker(path.join(__dirname, "worker.js"), {
        workerData: {
          roots: this.options.roots,
          cacheDir: path.join(app.getPath("userData"), "local-monitor"),
        },
      });
    } catch {
      for (const view of this.windows.values()) {
        view.workerError = true;
        view.refreshing = false;
      }
      return;
    }
    this.worker = worker;
    worker.on("message", (message: OmpMonitorWorkerResponse) => {
      if (this.worker !== worker || this.disposed) return;
      if (message.type === "error") {
        for (const view of this.windows.values()) {
          view.workerError = true;
          view.refreshing = false;
        }
        this.sendStates();
        return;
      }
      const view = this.windows.get(message.scopeId);
      if (
        !view ||
        message.snapshot.scope.profile !== view.scope.profile ||
        message.snapshot.scope.project !== view.scope.project
      )
        return;
      view.snapshot = message.snapshot;
      view.workerError = false;
      view.refreshing = message.snapshot.status === "scanning";
      this.scopes = message.snapshot.scopes;
      this.sendState(view);
    });
    const failed = () => {
      if (this.worker !== worker || this.disposed) return;
      this.stopWorker();
      for (const view of this.windows.values()) {
        view.workerError = true;
        view.refreshing = false;
      }
      this.sendStates();
    };
    worker.on("error", failed);
    worker.on("exit", failed);
    this.postScopes();
    this.updateVisibility();
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.removeAllListeners("message");
    worker.removeAllListeners("exit");
    // Keep the guarded error listener until termination; late errors must not become uncaught.
    void worker.terminate().catch(() => undefined);
  }

  private post(message: OmpMonitorWorkerRequest): void {
    if (this.worker) this.worker.postMessage(message, NO_TRANSFERABLES);
  }

  private postScopes(): void {
    const scopes: Array<{ id: string; scope: OmpMonitorScope }> = [];
    for (const [id, view] of this.windows) scopes.push({ id, scope: view.scope });
    this.post({ type: "scopes", scopes });
  }

  private readonly updateVisibility = (): void => {
    let visible = false;
    for (const { window } of this.windows.values()) {
      if (!window.isDestroyed() && window.isVisible() && !window.isMinimized()) {
        visible = true;
        break;
      }
    }
    this.post({ type: "visibility", visible });
  };

  private viewState(view: MonitorWindow): OmpMonitorViewState {
    return {
      language: app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en",
      compact: view.compact,
      pinned: view.pinned,
      scope: view.scope,
      scopes: this.scopes,
      snapshot: view.snapshot,
      workerError: view.workerError,
      refreshing: view.refreshing,
      windowCount: this.windows.size,
      maxWindows: MAX_WINDOWS,
    };
  }

  private sendState(view: MonitorWindow): void {
    if (this.disposed || view.window.isDestroyed() || view.window.webContents.isDestroyed()) return;
    view.window.webContents.send("paseo:monitor:state", this.viewState(view));
  }

  private sendStates(): void {
    for (const view of this.windows.values()) this.sendState(view);
  }

  private setCompact(view: MonitorWindow, compact: boolean): void {
    if (view.compact === compact) return;
    const current = view.window.getBounds();
    if (compact) view.dashboardBounds = current;
    else view.compactBounds = current;
    view.compact = compact;
    const bounds = this.clampBounds(
      compact ? (view.compactBounds ?? { ...current, ...COMPACT_SIZE }) : view.dashboardBounds,
    );
    view.window.setMinimumSize(1, 1);
    view.window.setResizable(!compact);
    view.window.setBounds(bounds);
    const area = screen.getDisplayMatching(bounds).workArea;
    view.window.setMinimumSize(
      Math.min(compact ? COMPACT_SIZE.width : 720, area.width),
      Math.min(compact ? COMPACT_SIZE.height : 540, area.height),
    );
    this.sendState(view);
  }

  private clampBounds(bounds: Rectangle): Rectangle {
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(Math.max(1, Math.round(bounds.width)), area.width);
    const height = Math.min(Math.max(1, Math.round(bounds.height)), area.height);
    return {
      x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
      width,
      height,
    };
  }

  private clampWindow(view: MonitorWindow): void {
    if (view.window.isDestroyed()) return;
    const before = view.window.getBounds(),
      after = this.clampBounds(before);
    const area = screen.getDisplayMatching(after).workArea;
    view.window.setMinimumSize(
      Math.min(view.compact ? COMPACT_SIZE.width : 720, area.width),
      Math.min(view.compact ? COMPACT_SIZE.height : 540, area.height),
    );
    if (
      before.x !== after.x ||
      before.y !== after.y ||
      before.width !== after.width ||
      before.height !== after.height
    )
      view.window.setBounds(after);
    view.dashboardBounds = this.clampBounds(view.dashboardBounds);
    if (view.compactBounds) view.compactBounds = this.clampBounds(view.compactBounds);
  }

  private readonly onDisplaysChanged = (): void => {
    for (const view of this.windows.values()) this.clampWindow(view);
  };

  private async exportCsv(view: MonitorWindow): Promise<OmpMonitorExportResult> {
    const snapshot = view.snapshot;
    if (
      snapshot &&
      (snapshot.status === "unavailable" ||
        snapshot.status === "error" ||
        (snapshot.status === "scanning" && snapshot.coverage.readFiles === 0))
    )
      return "unavailable";
    if (
      !snapshot ||
      view.exporting ||
      snapshot.scope.profile !== view.scope.profile ||
      snapshot.scope.project !== view.scope.project
    )
      return "unavailable";
    view.exporting = true;
    try {
      const result = await dialog.showSaveDialog(view.window, {
        title: app.getLocale().toLowerCase().startsWith("zh")
          ? "导出 OMP 本地监控 CSV"
          : "Export OMP local monitor CSV",
        defaultPath: `omp-monitor-${new Date(snapshot.updatedAt).toISOString().slice(0, 10)}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return "cancelled";
      await writeFile(result.filePath, "\uFEFF" + buildMonitorCsv(snapshot), "utf8");
      return "saved";
    } catch {
      return "failed";
    } finally {
      view.exporting = false;
    }
  }
}

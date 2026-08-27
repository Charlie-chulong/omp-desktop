export interface BackgroundModeWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  hide(): void;
  show(): void;
  focus(): void;
  on(event: "close", listener: (event: BackgroundModeCloseEvent) => void): void;
}

export interface BackgroundModeCloseEvent {
  preventDefault(): void;
}

export type BackgroundModeCloseChoice = "background" | "quit" | "cancel";

interface BackgroundModeDependencies {
  promptForCloseChoice(window: BackgroundModeWindow): Promise<BackgroundModeCloseChoice>;
  createTray(actions: { restore: () => void; quit: () => void }): void;
  getWindows(): BackgroundModeWindow[];
  createWindow(): Promise<BackgroundModeWindow>;
  quitApp(): void;
  onError(error: unknown): void;
}

export class BackgroundModeController {
  private readonly backgroundWindows = new Set<BackgroundModeWindow>();
  private readonly pendingPrompts = new Set<BackgroundModeWindow>();
  private trayCreated = false;
  private appQuitting = false;

  constructor(private readonly dependencies: BackgroundModeDependencies) {}

  registerWindow(window: BackgroundModeWindow): void {
    window.on("close", (event) => {
      this.handleWindowClose(window, event);
    });
  }
  initializeTray(): void {
    this.ensureTray();
  }

  markAppQuitting(): void {
    this.appQuitting = true;
  }

  restoreWindows(): void {
    void this.restoreWindowsAsync().catch(this.dependencies.onError);
  }

  quitApp(): void {
    this.appQuitting = true;
    this.dependencies.quitApp();
  }

  private handleWindowClose(window: BackgroundModeWindow, event: BackgroundModeCloseEvent): void {
    if (this.appQuitting) {
      return;
    }

    event.preventDefault();
    if (this.pendingPrompts.has(window)) {
      return;
    }

    this.pendingPrompts.add(window);
    void this.applyCloseChoice(window);
  }

  private async applyCloseChoice(window: BackgroundModeWindow): Promise<void> {
    try {
      const choice = await this.dependencies.promptForCloseChoice(window);
      if (choice === "quit") {
        this.quitApp();
        return;
      }
      if (choice === "cancel") {
        return;
      }
      if (window.isDestroyed()) {
        return;
      }

      this.ensureTray();
      this.backgroundWindows.add(window);
      window.hide();
    } catch (error) {
      this.dependencies.onError(error);
    } finally {
      this.pendingPrompts.delete(window);
    }
  }

  private ensureTray(): void {
    if (this.trayCreated) {
      return;
    }

    this.dependencies.createTray({
      restore: () => this.restoreWindows(),
      quit: () => this.quitApp(),
    });
    this.trayCreated = true;
  }

  private async restoreWindowsAsync(): Promise<void> {
    const backgroundWindows = [...this.backgroundWindows].filter((window) => !window.isDestroyed());
    this.backgroundWindows.clear();

    const windows =
      backgroundWindows.length > 0
        ? backgroundWindows
        : this.dependencies.getWindows().filter((window) => !window.isDestroyed());
    if (windows.length === 0) {
      const window = await this.dependencies.createWindow();
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
      return;
    }

    for (const window of windows) {
      if (!window.isVisible()) {
        window.show();
      }
    }
    windows[0]?.focus();
  }
}

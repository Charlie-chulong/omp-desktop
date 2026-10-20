import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

export interface RendererLossDetails {
  reason: string;
  exitCode?: number;
}

export interface RendererLossRecoveryWindow {
  isDestroyed(): boolean;
}

export interface RendererLossDialogWindow extends RendererLossRecoveryWindow {
  isMinimized(): boolean;
  restore(): void;
  isVisible(): boolean;
  show(): void;
  focus(): void;
}

export interface RendererLossReplacementOptions {
  initialRoute: string;
  pendingOpenProjectPath: string | null;
  restoreWindowState: boolean;
}

export type RendererLossChoice = "reload" | "close";

type ShowMessageBox = (
  options: MessageBoxOptions,
) => Promise<Pick<MessageBoxReturnValue, "response">>;

interface RendererLossRecoveryDependencies<Window extends RendererLossRecoveryWindow> {
  getReplacementOptions(window: Window): RendererLossReplacementOptions;
  showRecoveryPrompt(window: Window, details: RendererLossDetails): Promise<RendererLossChoice>;
  showRecoveryFailure(window: Window, error: unknown): Promise<void>;
  createWindow(options: RendererLossReplacementOptions, failedWindow: Window): Promise<Window>;
  closeWindow(window: Window): void;
  onRendererLoss(window: Window, details: RendererLossDetails): void;
  onError(error: unknown): void;
}

export function getRendererRecoveryRoute(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.startsWith("/") ? parsed.pathname : "/";
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function presentRendererLossWindow(window: RendererLossDialogWindow): void {
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

export async function showRendererLossPrompt(
  window: RendererLossDialogWindow,
  showMessageBox: ShowMessageBox,
  details: RendererLossDetails,
): Promise<RendererLossChoice> {
  const exitCode = typeof details.exitCode === "number" ? `\nExit code: ${details.exitCode}` : "";
  presentRendererLossWindow(window);
  const result = await showMessageBox({
    type: "error",
    title: "OMP Desktop window stopped",
    message: "This window's renderer stopped unexpectedly.",
    detail: `Reason: ${details.reason}${exitCode}\n\nReload the window to continue. Input that was not sent may be lost.`,
    buttons: ["Reload window", "Close window"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0 ? "reload" : "close";
}

export async function showRendererRecoveryFailure(
  window: RendererLossDialogWindow,
  showMessageBox: ShowMessageBox,
  error: unknown,
): Promise<void> {
  const details = error instanceof Error ? error.message : String(error);
  presentRendererLossWindow(window);
  await showMessageBox({
    type: "error",
    title: "OMP Desktop could not reload",
    message: "The replacement window could not be opened.",
    detail: details,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
}

export class RendererLossRecoveryController<Window extends RendererLossRecoveryWindow> {
  private readonly pendingRecoveries = new WeakMap<Window, Promise<void>>();
  private shuttingDown = false;

  constructor(private readonly dependencies: RendererLossRecoveryDependencies<Window>) {}

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  handleRendererLoss(window: Window, details: RendererLossDetails): Promise<void> {
    this.reportRendererLoss(window, details);
    if (!this.canRecover(window)) return Promise.resolve();

    const pending = this.pendingRecoveries.get(window);
    if (pending) return pending;

    const recovery = Promise.resolve()
      .then(() => this.recover(window, details))
      .catch((error) => {
        this.reportError(error);
      })
      .finally(() => {
        this.pendingRecoveries.delete(window);
      });
    this.pendingRecoveries.set(window, recovery);
    return recovery;
  }

  private async recover(window: Window, details: RendererLossDetails): Promise<void> {
    if (!this.canRecover(window)) return;
    const replacementOptions = this.dependencies.getReplacementOptions(window);

    while (this.canRecover(window)) {
      const choice = await this.dependencies.showRecoveryPrompt(window, details);
      if (!this.canRecover(window)) return;

      if (choice === "close") {
        this.dependencies.closeWindow(window);
        return;
      }

      let replacement: Window;
      try {
        replacement = await this.dependencies.createWindow(replacementOptions, window);
      } catch (error) {
        if (!this.canRecover(window)) return;
        await this.dependencies.showRecoveryFailure(window, error);
        continue;
      }

      if (!this.canRecover(window)) {
        if (!replacement.isDestroyed()) this.dependencies.closeWindow(replacement);
        return;
      }

      if (replacement.isDestroyed()) {
        await this.dependencies.showRecoveryFailure(
          window,
          new Error("The replacement window closed before it was ready"),
        );
        continue;
      }

      this.dependencies.closeWindow(window);
      return;
    }
  }

  private canRecover(window: Window): boolean {
    return !this.shuttingDown && !window.isDestroyed();
  }

  private reportRendererLoss(window: Window, details: RendererLossDetails): void {
    try {
      this.dependencies.onRendererLoss(window, details);
    } catch {
      // Logging must never turn a renderer failure into an unhandled rejection.
    }
  }

  private reportError(error: unknown): void {
    try {
      this.dependencies.onError(error);
    } catch {
      // Error reporting is the final boundary for this detached lifecycle.
    }
  }
}

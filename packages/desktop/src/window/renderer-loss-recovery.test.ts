import { describe, expect, it, vi } from "vitest";

import {
  getRendererRecoveryRoute,
  RendererLossRecoveryController,
  showRendererLossPrompt,
  type RendererLossChoice,
  type RendererLossReplacementOptions,
} from "./renderer-loss-recovery.js";

class FakeWindow {
  destroyed = false;
  focusedCount = 0;
  restoredCount = 0;
  shownCount = 0;

  constructor(
    readonly url: string,
    public visible = true,
    public minimized = false,
  ) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  restore(): void {
    this.minimized = false;
    this.restoredCount += 1;
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.shownCount += 1;
  }

  focus(): void {
    this.focusedCount += 1;
  }
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createController(input: {
  prompt?: (window: FakeWindow) => Promise<RendererLossChoice>;
  showFailure?: (window: FakeWindow, error: unknown) => Promise<void>;
  createWindow?: (options: RendererLossReplacementOptions) => Promise<FakeWindow>;
  closeWindow?: (window: FakeWindow) => void;
  onLoss?: (window: FakeWindow) => void;
  onError?: (error: unknown) => void;
  pendingOpenProjectPath?: string | null;
  restoreWindowState?: boolean;
}) {
  const replacement = new FakeWindow("omp-desktop://app/replacement");
  const prompt = input.prompt ?? vi.fn().mockResolvedValue("close");
  const showFailure = input.showFailure ?? vi.fn().mockResolvedValue(undefined);
  const createWindow = input.createWindow ?? vi.fn().mockResolvedValue(replacement);
  const closeWindow =
    input.closeWindow ??
    ((window: FakeWindow) => {
      window.destroyed = true;
    });
  const onLoss = input.onLoss ?? vi.fn();
  const onError = input.onError ?? vi.fn();
  const controller = new RendererLossRecoveryController<FakeWindow>({
    getReplacementOptions: (window) => ({
      initialRoute: getRendererRecoveryRoute(window.url),
      pendingOpenProjectPath: input.pendingOpenProjectPath ?? null,
      restoreWindowState: input.restoreWindowState ?? false,
    }),
    showRecoveryPrompt: prompt,
    showRecoveryFailure: showFailure,
    createWindow,
    closeWindow,
    onRendererLoss: onLoss,
    onError,
  });
  return { controller, prompt, showFailure, createWindow, replacement, onLoss, onError };
}

const lossDetails = { reason: "crashed", exitCode: 23 };

describe("renderer loss recovery", () => {
  it.each([
    { name: "visible", visible: true, minimized: false },
    { name: "hidden", visible: false, minimized: false },
    { name: "minimized", visible: true, minimized: true },
  ])("offers a decision for a running $name window", async ({ visible, minimized }) => {
    const window = new FakeWindow("omp-desktop://app/agents", visible, minimized);
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1 });
    const prompt = vi.fn((candidate: FakeWindow) =>
      showRendererLossPrompt(candidate, showMessageBox, lossDetails),
    );
    const harness = createController({ prompt });

    await harness.controller.handleRendererLoss(window, lossDetails);

    expect(prompt).toHaveBeenCalledOnce();
    expect(window.restoredCount).toBe(minimized ? 1 : 0);
    expect(window.shownCount).toBe(visible ? 0 : 1);
    expect(window.focusedCount).toBe(1);
    expect(window.destroyed).toBe(true);
  });

  it("maps native dialog dismissal to an explicit close decision", async () => {
    const window = new FakeWindow("omp-desktop://app/agents");
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1 });

    await expect(showRendererLossPrompt(window, showMessageBox, lossDetails)).resolves.toBe(
      "close",
    );
  });

  it("shares one pending decision when the same window reports concurrent losses", async () => {
    const choice = deferred<RendererLossChoice>();
    const prompt = vi.fn(() => choice.promise);
    const window = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({ prompt });

    const first = harness.controller.handleRendererLoss(window, lossDetails);
    const second = harness.controller.handleRendererLoss(window, {
      reason: "oom",
      exitCode: 47,
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(second).toBe(first);

    choice.resolve("close");
    await Promise.all([first, second]);
    expect(window.destroyed).toBe(true);
  });

  it("does not prompt for an already destroyed window", async () => {
    const window = new FakeWindow("omp-desktop://app/agents");
    window.destroyed = true;
    const harness = createController({});

    await harness.controller.handleRendererLoss(window, lossDetails);

    expect(harness.prompt).not.toHaveBeenCalled();
    expect(harness.createWindow).not.toHaveBeenCalled();
  });

  it("does not prompt or create after application shutdown begins", async () => {
    const window = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({});
    harness.controller.beginShutdown();

    await harness.controller.handleRendererLoss(window, lossDetails);

    expect(harness.prompt).not.toHaveBeenCalled();
    expect(harness.createWindow).not.toHaveBeenCalled();
    expect(window.destroyed).toBe(false);
  });

  it("abandons a pending reload when shutdown begins while the decision is open", async () => {
    const choice = deferred<RendererLossChoice>();
    const prompt = vi.fn(() => choice.promise);
    const window = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({ prompt });

    const recovery = harness.controller.handleRendererLoss(window, lossDetails);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    harness.controller.beginShutdown();
    choice.resolve("reload");
    await recovery;

    expect(harness.createWindow).not.toHaveBeenCalled();
    expect(window.destroyed).toBe(false);
  });

  it("does not replace a window closed while its recovery decision is open", async () => {
    const choice = deferred<RendererLossChoice>();
    const prompt = vi.fn(() => choice.promise);
    const window = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({ prompt });

    const recovery = harness.controller.handleRendererLoss(window, lossDetails);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    window.destroyed = true;
    choice.resolve("reload");
    await recovery;

    expect(harness.createWindow).not.toHaveBeenCalled();
  });

  it("discards a replacement completed after the failed window was closed", async () => {
    const creation = deferred<FakeWindow>();
    const replacement = new FakeWindow("omp-desktop://app/replacement");
    const createWindow = vi.fn(() => creation.promise);
    const closed: FakeWindow[] = [];
    const window = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({
      prompt: vi.fn().mockResolvedValue("reload"),
      createWindow,
      closeWindow: (candidate) => {
        candidate.destroyed = true;
        closed.push(candidate);
      },
    });

    const recovery = harness.controller.handleRendererLoss(window, lossDetails);
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
    window.destroyed = true;
    creation.resolve(replacement);
    await recovery;

    expect(closed).toEqual([replacement]);
  });

  it("discards a replacement completed after application shutdown begins", async () => {
    const creation = deferred<FakeWindow>();
    const replacement = new FakeWindow("omp-desktop://app/replacement");
    const createWindow = vi.fn(() => creation.promise);
    const closed: FakeWindow[] = [];
    const failed = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({
      prompt: vi.fn().mockResolvedValue("reload"),
      createWindow,
      closeWindow: (window) => {
        window.destroyed = true;
        closed.push(window);
      },
    });

    const recovery = harness.controller.handleRendererLoss(failed, lossDetails);
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
    harness.controller.beginShutdown();
    creation.resolve(replacement);
    await recovery;

    expect(closed).toEqual([replacement]);
    expect(failed.destroyed).toBe(false);
  });

  it("keeps the failed window while reporting a replacement failure and asks again", async () => {
    const secondChoice = deferred<RendererLossChoice>();
    const prompt = vi
      .fn<(window: FakeWindow) => Promise<RendererLossChoice>>()
      .mockResolvedValueOnce("reload")
      .mockImplementationOnce(() => secondChoice.promise);
    const createWindow = vi.fn().mockRejectedValue(new Error("replacement failed"));
    const showFailure = vi.fn().mockResolvedValue(undefined);
    const window = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({ prompt, createWindow, showFailure });

    const recovery = harness.controller.handleRendererLoss(window, lossDetails);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(showFailure).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(false);

    secondChoice.resolve("close");
    await recovery;
    expect(window.destroyed).toBe(true);
  });

  it("creates the replacement before closing the failed window and preserves recovery state", async () => {
    const events: string[] = [];
    const replacement = new FakeWindow("omp-desktop://app/replacement");
    const createWindow = vi.fn(async () => {
      events.push("replacement-created");
      return replacement;
    });
    const failed = new FakeWindow(
      "omp-desktop://app/projects/current?panel=files&draft=1#selected-message",
    );
    const harness = createController({
      prompt: vi.fn().mockResolvedValue("reload"),
      createWindow,
      closeWindow: (window) => {
        events.push(window === failed ? "failed-closed" : "replacement-closed");
        window.destroyed = true;
      },
      pendingOpenProjectPath: "C:\\work\\current-project",
      restoreWindowState: true,
    });

    await harness.controller.handleRendererLoss(failed, lossDetails);

    expect(createWindow).toHaveBeenCalledWith(
      {
        initialRoute: "/projects/current?panel=files&draft=1#selected-message",
        pendingOpenProjectPath: "C:\\work\\current-project",
        restoreWindowState: true,
      },
      failed,
    );
    expect(events).toEqual(["replacement-created", "failed-closed"]);
    expect(replacement.destroyed).toBe(false);
  });

  it("keeps path, search, and hash while dropping the old renderer origin", () => {
    expect(
      getRendererRecoveryRoute("http://localhost:8081/agents/thread%201?draft=yes#message-9"),
    ).toBe("/agents/thread%201?draft=yes#message-9");
    expect(getRendererRecoveryRoute("not a window URL")).toBe("/");
  });

  it("contains prompt failures without closing the failed window", async () => {
    const onError = vi.fn();
    const window = new FakeWindow("omp-desktop://app/agents");
    const harness = createController({
      prompt: vi.fn().mockRejectedValue(new Error("dialog unavailable")),
      onError,
    });

    await expect(
      harness.controller.handleRendererLoss(window, lossDetails),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(false);
  });
});

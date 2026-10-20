/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTitlebarWindowDragSurface } from "./titlebar-drag-region";

const state = vi.hoisted(() => ({ maximized: true, mac: false }));
const bridge = vi.hoisted(() => ({
  beginWindowDrag: vi.fn(() => Promise.resolve()),
  moveWindowDrag: vi.fn(),
  endWindowDrag: vi.fn(),
  toggleMaximize: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/utils/desktop-window", () => ({
  useIsDesktopWindowMaximized: () => state.maximized,
}));
vi.mock("@/constants/layout", () => ({
  getIsElectronRuntime: () => true,
  getIsElectronRuntimeMac: () => state.mac,
}));
vi.mock("@/desktop/electron/window", () => ({ getDesktopWindow: () => bridge }));

let mounted: { root: Root; container: HTMLDivElement } | undefined;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function Surface() {
  const surface = useTitlebarWindowDragSurface();
  return (
    <View {...surface} testID="titlebar">
      <button type="button">
        <span>Control</span>
      </button>
    </View>
  );
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() => root.render(<Surface />));
  const element = container.querySelector('[data-testid="titlebar"]');
  if (!(element instanceof HTMLElement)) throw new Error("Missing titlebar surface");
  return element;
}

function pointer(target: Element, type: string, x = 100, y = 20, buttons = 1): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, buttons, screenX: x, screenY: y });
  act(() => {
    target.dispatchEvent(event);
  });
}

function click(target: Element, detail: number): void {
  pointer(target, "pointerdown");
  pointer(target, "pointerup", 100, 20, 0);
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
  });
}

function flushFrames(): void {
  const callbacks = Array.from(frames.values());
  frames.clear();
  act(() => {
    for (const callback of callbacks) callback(0);
  });
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.maximized = true;
  state.mac = false;
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
});

afterEach(() => {
  if (mounted) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = undefined;
  }
  vi.unstubAllGlobals();
});

describe("maximized titlebar gestures", () => {
  it("leaves a single click maximized and restores on the second click without starting a move", () => {
    const surface = mount();
    click(surface, 1);
    expect(bridge.toggleMaximize).not.toHaveBeenCalled();
    expect(bridge.beginWindowDrag).not.toHaveBeenCalled();
    click(surface, 2);
    expect(bridge.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(bridge.beginWindowDrag).not.toHaveBeenCalled();
    expect(bridge.endWindowDrag).not.toHaveBeenCalled();
  });

  it("ignores pointer jitter, then restores and moves only after a real drag begins", () => {
    const surface = mount();
    pointer(surface, "pointerdown");
    pointer(surface, "pointermove", 102, 21);
    flushFrames();
    expect(bridge.beginWindowDrag).not.toHaveBeenCalled();
    expect(bridge.moveWindowDrag).not.toHaveBeenCalled();
    pointer(surface, "pointermove", 105, 25);
    pointer(surface, "pointermove", 130, 40);
    flushFrames();
    expect(bridge.beginWindowDrag).toHaveBeenCalledExactlyOnceWith({ screenX: 100, screenY: 20 });
    expect(bridge.moveWindowDrag).toHaveBeenLastCalledWith({ screenX: 130, screenY: 40 });
    pointer(surface, "pointerup", 130, 40, 0);
    expect(bridge.endWindowDrag).toHaveBeenCalledTimes(1);
    act(() => {
      surface.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    });
    expect(bridge.toggleMaximize).not.toHaveBeenCalled();
  });

  it("does not turn double-clicks or drags on nested controls into window gestures", () => {
    const surface = mount();
    const label = surface.querySelector("span");
    if (!label) throw new Error("Missing control label");
    click(label, 1);
    click(label, 2);
    pointer(label, "pointerdown");
    pointer(label, "pointermove", 150, 80);
    pointer(label, "pointerup", 150, 80, 0);
    flushFrames();
    expect(bridge.toggleMaximize).not.toHaveBeenCalled();
    expect(bridge.beginWindowDrag).not.toHaveBeenCalled();
  });

  it("cancels buffered motion on blur and permits a new gesture", () => {
    const surface = mount();
    pointer(surface, "pointerdown");
    pointer(surface, "pointermove", 130, 40);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    flushFrames();
    expect(bridge.moveWindowDrag).not.toHaveBeenCalled();
    expect(bridge.endWindowDrag).toHaveBeenCalledTimes(1);
    click(surface, 1);
    click(surface, 2);
    expect(bridge.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it.each([
    { maximized: false, mac: false },
    { maximized: true, mac: true },
  ])("leaves native chrome in charge for %j", (platform) => {
    Object.assign(state, platform);
    const surface = mount();
    click(surface, 1);
    click(surface, 2);
    pointer(surface, "pointerdown");
    pointer(surface, "pointermove", 130, 40);
    pointer(surface, "pointerup", 130, 40, 0);
    flushFrames();
    expect(bridge.toggleMaximize).not.toHaveBeenCalled();
    expect(bridge.beginWindowDrag).not.toHaveBeenCalled();
  });
});

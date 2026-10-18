import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import { QueuedConversationOrder } from "./queued-conversation-order";

// Runtime delivery is covered by host-runtime.test; browser gestures use the real queue store.
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ reevaluateQueuedAgentMessages: () => undefined }),
}));
const serverId = "browser-queued-conversations";
let root: Root;
let container: HTMLDivElement;

function queue(...agentIds: string[]): void {
  useSessionStore
    .getState()
    .setQueuedMessages(
      serverId,
      new Map(
        agentIds.map((agentId) => [
          agentId,
          [{ id: `message-${agentId}`, text: `Message for ${agentId}`, attachments: [] }],
        ]),
      ),
    );
}

function orderedRows(): string[] {
  return [...container.querySelectorAll('[data-testid^="queued-conversation-"]')]
    .filter((row) =>
      /^queued-conversation-(alpha|beta|gamma)$/.test(row.getAttribute("data-testid") ?? ""),
    )
    .map((row) => row.getAttribute("data-testid")!.replace("queued-conversation-", ""));
}

function element(testId: string): HTMLElement {
  const found = container.querySelector(`[data-testid="${testId}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`Missing visible queue control ${testId}`);
  return found;
}

function sendTouch(
  target: HTMLElement,
  type: "touchstart" | "touchmove" | "touchend",
  x: number,
  y: number,
): void {
  const touch = new Touch({
    identifier: 1,
    target,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    screenX: x,
    screenY: y,
  });
  const activeTouches = type === "touchend" ? [] : [touch];
  target.dispatchEvent(
    new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: activeTouches,
      targetTouches: activeTouches,
      changedTouches: [touch],
    }),
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (!i18n.isInitialized) await i18n.init();
  await i18n.changeLanguage("en");
  useSessionStore.getState().initializeSession(serverId, null as unknown as DaemonClient);
  container = document.createElement("div");
  container.style.width = "360px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<QueuedConversationOrder serverId={serverId} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSessionStore.getState().clearSession(serverId);
  vi.unstubAllGlobals();
});

describe("queued conversation order on a touch-sized screen", () => {
  it("drags the third pending conversation to the front by its touch handle", async () => {
    act(() => queue("alpha", "beta", "gamma"));
    expect(orderedRows()).toEqual(["alpha", "beta", "gamma"]);
    const handle = element("queued-conversation-drag-gamma");
    const firstRow = element("queued-conversation-alpha");
    const from = handle.getBoundingClientRect();
    const to = firstRow.getBoundingClientRect();
    const x = from.x + from.width / 2;
    const startY = from.y + from.height / 2;
    const endY = to.y + to.height / 2;

    act(() => sendTouch(handle, "touchstart", x, startY));
    await new Promise((resolve) => setTimeout(resolve, 230));
    act(() => sendTouch(handle, "touchmove", x, endY));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    act(() => sendTouch(handle, "touchend", x, endY));

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessions[serverId]?.queuedAgentOrder).toEqual([
        "gamma",
        "alpha",
        "beta",
      ]);
      expect(orderedRows()).toEqual(["gamma", "alpha", "beta"]);
    });
    expect(element("queued-conversation-drag-gamma").getAttribute("role")).toBe("button");
    expect(element("queued-conversation-order").textContent).toContain("gamma");
  });

  it("does not overwrite another composer's move made while a touch drag is held", async () => {
    act(() => queue("alpha", "beta", "gamma"));
    const handle = element("queued-conversation-drag-gamma");
    const from = handle.getBoundingClientRect();
    const to = element("queued-conversation-alpha").getBoundingClientRect();
    const x = from.x + from.width / 2;
    const startY = from.y + from.height / 2;
    const endY = to.y + to.height / 2;

    act(() => sendTouch(handle, "touchstart", x, startY));
    await new Promise((resolve) => setTimeout(resolve, 230));
    act(() => useSessionStore.getState().moveQueuedAgent(serverId, "alpha", 1));
    expect(useSessionStore.getState().sessions[serverId]?.queuedAgentOrder).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
    act(() => sendTouch(handle, "touchmove", x, endY));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    act(() => sendTouch(handle, "touchend", x, endY));

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessions[serverId]?.queuedAgentOrder).toEqual([
        "beta",
        "alpha",
        "gamma",
      ]);
      expect(orderedRows()).toEqual(["beta", "alpha", "gamma"]);
    });
  });

  it("allows tap-only adjacent moves and hides the board when only one conversation remains", async () => {
    act(() => queue("alpha"));
    expect(container.querySelector('[data-testid="queued-conversation-order"]')).toBeNull();

    act(() => queue("alpha", "beta"));
    expect(orderedRows()).toEqual(["alpha", "beta"]);
    expect(element("queued-conversation-earlier-alpha").getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(element("queued-conversation-earlier-beta"));
    await vi.waitFor(() => expect(orderedRows()).toEqual(["beta", "alpha"]));
    expect(useSessionStore.getState().sessions[serverId]?.queuedAgentOrder).toEqual([
      "beta",
      "alpha",
    ]);
    const keyboardHandle = element("queued-conversation-drag-alpha");
    keyboardHandle.focus();
    await act(async () => {
      await userEvent.keyboard("[Space]");
    });
    await act(async () => {
      await nextFrame();
    });
    await act(async () => {
      await userEvent.keyboard("[ArrowUp]");
    });
    await act(async () => {
      await userEvent.keyboard("[Space]");
    });
    await vi.waitFor(() => expect(orderedRows()).toEqual(["alpha", "beta"]));
    expect(useSessionStore.getState().sessions[serverId]?.queuedAgentOrder).toEqual([
      "alpha",
      "beta",
    ]);

    act(() => queue("alpha"));
    expect(container.querySelector('[data-testid="queued-conversation-order"]')).toBeNull();
  });
});

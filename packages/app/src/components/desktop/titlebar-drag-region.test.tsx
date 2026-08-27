/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScrollView } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TITLEBAR_DRAG_REGION_DATASET } from "./titlebar-drag-region";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
  vi.unstubAllGlobals();
});

describe("TITLEBAR_DRAG_REGION_DATASET", () => {
  it("renders the exact hyphenated attribute consumed by the titlebar CSS", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() =>
      root.render(
        <ScrollView
          horizontal
          dataSet={TITLEBAR_DRAG_REGION_DATASET}
          testID="titlebar-scroll-surface"
        />,
      ),
    );

    const surface = container.querySelector('[data-testid="titlebar-scroll-surface"]');
    if (!(surface instanceof HTMLElement)) {
      throw new Error("Titlebar scroll surface did not render");
    }

    expect(surface.hasAttribute("data-window-drag-region")).toBe(true);
    expect(surface.hasAttribute("data-windowdragregion")).toBe(false);
  });
});

// @vitest-environment jsdom
import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { darkTheme, type Theme } from "@/styles/theme";
import { setCssColorAlpha } from "@/wallpaper/color";
import { AppearanceStyleBoundary } from "./appearance-style-boundary";

interface BoundaryProps {
  appearanceKey?: string;
  children?: ReactNode;
}

const state = vi.hoisted(() => ({ theme: null as Theme | null }));
vi.mock("react-native-unistyles", () => ({
  withUnistyles: (Component: ComponentType<BoundaryProps>) =>
    function ThemedBoundary({
      children,
      uniProps,
    }: {
      children: ReactNode;
      uniProps: (theme: Theme) => Partial<BoundaryProps>;
    }) {
      return createElement(Component, uniProps(state.theme!), children);
    },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.theme = darkTheme;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderEditor(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        AppearanceStyleBoundary,
        null,
        createElement("input", { "aria-label": "Wallpaper URL", defaultValue: "" }),
      ),
    );
  });
}

describe("appearance updates while editing", () => {
  it("preserves entered text and focus as wallpaper surfaces become ready or fail", async () => {
    await renderEditor();
    const input = container.querySelector("input")!;
    input.value = "https://example.test/wallpaper.png?version=2";
    input.focus();

    for (const alpha of [0.85, 1, 0.85]) {
      state.theme = {
        ...darkTheme,
        colors: {
          ...darkTheme.colors,
          surface1: setCssColorAlpha(darkTheme.colors.surface1, alpha),
          surface2: setCssColorAlpha(darkTheme.colors.surface2, alpha),
        },
      };
      await renderEditor();
      expect(container.querySelector("input")?.value).toBe(
        "https://example.test/wallpaper.png?version=2",
      );
      expect(document.activeElement).toBe(input);
    }
  });
});

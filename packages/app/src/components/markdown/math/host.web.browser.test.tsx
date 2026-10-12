import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TextStyle } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { applyRootUiFont } from "@/appearance/apply-root-font.web";
import { darkTheme, lightTheme } from "@/styles/theme";
import { MarkdownMath } from "./host.web";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
const EMPTY_TEXT_STYLE = {};
const DARK_TEXT_STYLE = { color: darkTheme.colors.foreground, fontSize: 15 };
const LIGHT_TEXT_STYLE = { color: lightTheme.colors.foreground, fontSize: 15 };

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.getElementById("paseo-ui-font")?.remove();
  document.documentElement.style.removeProperty("--paseo-ui-font");
});

function mount(rootId = "root") {
  const container = document.createElement("div");
  container.id = rootId;
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  return { root, container };
}

function formula(tex: string, displayMode: boolean, inheritedStyles: TextStyle) {
  return (
    <MarkdownMath
      tex={tex}
      displayMode={displayMode}
      inheritedStyles={inheritedStyles}
      textStyle={EMPTY_TEXT_STYLE}
    />
  );
}

describe("chat math appearance", () => {
  it.each(["root", "overlay-root"])(
    "keeps binomial fonts and layout under the UI font rule in %s",
    async (rootId) => {
      const { root, container } = mount(rootId);
      applyRootUiFont("Arial");
      await act(async () =>
        root.render(
          <>
            <span data-testid="prose">Prose</span>
            {formula(String.raw`\binom61`, true, DARK_TEXT_STYLE)}
          </>,
        ),
      );
      await document.fonts.ready;

      const katex = container.querySelector<HTMLElement>(".katex")!;
      const delimiters = [...container.querySelectorAll<HTMLElement>(".delimsizing")];
      const digits = [...container.querySelectorAll<HTMLElement>(".mfrac .mord")];
      const numerator = digits.find((digit) => digit.textContent === "6")!;
      const denominator = digits.find((digit) => digit.textContent === "1")!;
      expect(container.querySelector(".frac-line")).toBeNull();
      expect(delimiters.map((delimiter) => delimiter.textContent)).toEqual(["(", ")"]);
      expect(getComputedStyle(katex).fontFamily).toContain("KaTeX_Main");
      for (const delimiter of delimiters) {
        expect(getComputedStyle(delimiter).fontFamily).toContain("KaTeX_Size");
        const bounds = delimiter.getBoundingClientRect();
        const topDigit = numerator.getBoundingClientRect();
        const bottomDigit = denominator.getBoundingClientRect();
        expect(bounds.top).toBeLessThan(topDigit.top + topDigit.height / 2);
        expect(bounds.bottom).toBeGreaterThan(bottomDigit.top + bottomDigit.height / 2);
      }
      expect(numerator.getBoundingClientRect().bottom).toBeLessThan(
        denominator.getBoundingClientRect().top,
      );
      expect(
        getComputedStyle(container.querySelector<HTMLElement>('[data-testid="prose"]')!).fontFamily,
      ).toBe("Arial");

      applyRootUiFont("Courier New");
      expect(getComputedStyle(katex).fontFamily).toContain("KaTeX_Main");
      expect(
        getComputedStyle(container.querySelector<HTMLElement>('[data-testid="prose"]')!).fontFamily,
      ).toBe('"Courier New"');
    },
  );

  it("keeps inline and display fraction rules visible through theme changes and preserves TeX colors", async () => {
    const { root, container } = mount();
    applyRootUiFont("Arial");
    for (const [theme, inheritedStyles] of [
      [darkTheme, DARK_TEXT_STYLE],
      [lightTheme, LIGHT_TEXT_STYLE],
    ] as const) {
      container.style.backgroundColor = theme.colors.surface0;
      await act(async () =>
        root.render(
          <>
            {formula(String.raw`\frac38`, true, inheritedStyles)}
            {formula(String.raw`\frac38`, false, inheritedStyles)}
            {formula(String.raw`\color{red}{\frac38}`, true, inheritedStyles)}
          </>,
        ),
      );
      const hosts = [...container.querySelectorAll<HTMLElement>('[role="math"]')];
      for (const host of hosts.slice(0, 2)) {
        const line = host.querySelector<HTMLElement>(".frac-line")!;
        const style = getComputedStyle(line);
        expect(style.borderBottomColor).toBe(getComputedStyle(host).color);
        expect(style.borderBottomColor).not.toBe(getComputedStyle(container).backgroundColor);
        expect(style.borderBottomStyle).toBe("solid");
        expect(Number.parseFloat(style.borderBottomWidth)).toBeGreaterThan(0);
        expect(line.getBoundingClientRect().width).toBeGreaterThan(0);
      }
      expect(
        getComputedStyle(hosts[2].querySelector<HTMLElement>(".frac-line")!).borderBottomColor,
      ).toBe("rgb(255, 0, 0)");
    }
  });
});

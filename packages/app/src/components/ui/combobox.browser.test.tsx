import React, { useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Text, View } from "react-native";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxDesktopPlacement } from "./combobox";

vi.mock("expo-clipboard", () => ({}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const options = Array.from({ length: 60 }, (_, index) => ({
  id: `model-${index}`,
  label: `Model ${index}`,
}));
const mounted: { root: Root; container: HTMLDivElement }[] = [];
const anchorStyle = { height: 32 };

function mountPicker(top: number, placement: ComboboxDesktopPlacement, fixedHeight = 400) {
  const onSelect = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Picker() {
    const anchorRef = useRef<View>(null);
    const anchorContainerStyle = useMemo(
      () => ({ position: "fixed" as const, top, left: 30, width: 240 }),
      [],
    );
    return (
      <>
        <div style={anchorContainerStyle}>
          <View ref={anchorRef} style={anchorStyle}>
            <Text>Model selector</Text>
          </View>
        </div>
        <Combobox
          anchorRef={anchorRef}
          options={options}
          value="model-0"
          onSelect={onSelect}
          open
          searchable
          searchPlaceholder="Search models"
          desktopPlacement={placement}
          desktopFixedHeight={fixedHeight}
        />
      </>
    );
  }
  flushSync(() => root.render(<Picker />));
  mounted.push({ root, container });
  return onSelect;
}

function panel() {
  const element = document.querySelector('[data-testid="combobox-desktop-container"]');
  if (!(element instanceof HTMLElement)) throw new Error("Picker did not render");
  return element;
}

async function expectUsablePanel() {
  await expect
    .poll(() => {
      const element = panel();
      const rect = element.getBoundingClientRect();
      return (
        getComputedStyle(element).opacity !== "0" &&
        rect.top >= 15 &&
        rect.bottom <= window.innerHeight - 15 &&
        rect.height > 80
      );
    })
    .toBe(true);
  const search = panel().querySelector("input");
  if (!search) throw new Error("Search did not render");
  const rect = search.getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(16);
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight - 16);
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    flushSync(() => root.unmount());
    container.remove();
  }
  document.getElementById("overlay-root")?.remove();
});

describe("desktop model picker viewport boundaries", () => {
  it("keeps the floating model panel opaque so content behind it cannot bleed through", async () => {
    mountPicker(window.innerHeight - 52, "bottom-start");
    await expectUsablePanel();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser did not provide a canvas context");
    context.fillStyle = getComputedStyle(panel()).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    expect(context.getImageData(0, 0, 1, 1).data[3]).toBe(255);
  });

  it("opens upward at the bottom and selects the last model through scrolling", async () => {
    const onSelect = mountPicker(window.innerHeight - 52, "bottom-start");
    await expectUsablePanel();
    expect(panel().getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight - 57);
    const scroll = Array.from(panel().querySelectorAll<HTMLElement>("div")).find((element) =>
      ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
    );
    if (!scroll) throw new Error("Scrollable model list missing");
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    scroll.scrollTop = scroll.scrollHeight;
    const last = panel().querySelector('[aria-label="Model 59"]');
    if (!(last instanceof HTMLElement)) throw new Error("Last model missing");
    const rect = last.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(scroll.getBoundingClientRect().top);
    expect(rect.bottom).toBeLessThanOrEqual(scroll.getBoundingClientRect().bottom);
    await userEvent.click(last);
    expect(onSelect).toHaveBeenCalledWith("model-59");
  });

  it("flips a preferred upward picker downward at the top and keeps search usable", async () => {
    const onSelect = mountPicker(20, "top-start");
    await expectUsablePanel();
    expect(panel().getBoundingClientRect().top).toBeGreaterThanOrEqual(57);
    await userEvent.fill(panel().querySelector("input")!, "Model 59");
    await userEvent.click(panel().querySelector('[aria-label="Model 59"]')!);
    expect(onSelect).toHaveBeenCalledWith("model-59");
  });

  it("shrinks a fixed-height picker when neither side fits its preferred height", async () => {
    mountPicker(window.innerHeight / 2 - 16, "bottom-start", window.innerHeight);
    await expectUsablePanel();
    expect(panel().getBoundingClientRect().height).toBeLessThan(window.innerHeight / 2);
  });
});

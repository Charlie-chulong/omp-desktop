import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StyleProp, ViewStyle } from "react-native";
import { commands, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "./attachment-lightbox";

declare module "vitest/browser" {
  interface BrowserCommands {
    dragPointerWithinElement(selector: string, deltaX: number, deltaY: number): Promise<void>;
  }
}

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const imgFillStyle = vi.hoisted(
  () =>
    ({
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "contain",
    }) as const,
);
// expo-image's web entry imports a react-native path the browser harness cannot resolve.
// Mirror its web structure: a styled View wrapping a filled <img> that reports natural size.
vi.mock("expo-image", async () => {
  // vi.mock factories are hoisted above static imports, so the factory must load react-native itself.
  const { View } = await import("react-native");
  function Image({
    source,
    testID,
    style,
    onLoad,
    onError,
  }: {
    source: { uri: string };
    testID?: string;
    style?: StyleProp<ViewStyle>;
    onLoad?: (event: { source: { width: number; height: number } }) => void;
    onError?: () => void;
  }) {
    const handleLoad = React.useCallback(
      (event: React.SyntheticEvent<HTMLImageElement>) =>
        onLoad?.({
          source: {
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          },
        }),
      [onLoad],
    );
    return (
      <View testID={testID} style={style}>
        <img src={source.uri} alt="" style={imgFillStyle} onLoad={handleLoad} onError={onError} />
      </View>
    );
  }
  return { Image };
});

const mounted: Root[] = [];

afterEach(async () => {
  for (const root of mounted.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

/** 2000x1000 PNG, wider than the browser-test viewport so fit is below 100%. */
function createWideImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 2000;
  canvas.height = 1000;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.fillStyle = "#336699";
  context.fillRect(0, 0, 2000, 1000);
  return canvas.toDataURL("image/png");
}

function query(testID: string): HTMLElement {
  const element = document.querySelector(`[data-testid="${testID}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing ${testID}`);
  return element;
}

function zoomLevel(): string {
  return query("attachment-lightbox-zoom-level").textContent ?? "";
}

function imageRect(): DOMRect {
  return query("attachment-lightbox-image").getBoundingClientRect();
}

describe("ImageLightbox zoom", () => {
  it("zooms, pans and restores fit / 100% without dismissing the preview", async () => {
    const onClose = vi.fn();
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    mounted.push(root);
    await act(async () => {
      root.render(<ImageLightbox uri={createWideImage()} onClose={onClose} />);
    });

    await expect.poll(zoomLevel).toMatch(/^\d+%$/);
    const fitPercent = Number.parseInt(zoomLevel(), 10);
    expect(fitPercent).toBeLessThan(100);
    const fittedWidth = imageRect().width;

    const viewport = query("attachment-lightbox-viewport");
    const viewportRect = viewport.getBoundingClientRect();
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
        clientX: viewportRect.left + viewportRect.width / 2,
        clientY: viewportRect.top + viewportRect.height / 2,
      }),
    );
    await expect.poll(() => Number.parseInt(zoomLevel(), 10)).toBeGreaterThan(fitPercent);
    expect(imageRect().width).toBeGreaterThan(fittedWidth);

    await userEvent.click(query("attachment-lightbox-actual-size"));
    await expect.poll(zoomLevel).toBe("100%");
    expect(imageRect().width).toBeCloseTo(2000, 0);

    const beforeDrag = imageRect().left;
    await commands.dragPointerWithinElement(
      '[data-testid="attachment-lightbox-viewport"]',
      -120,
      0,
    );
    await expect.poll(() => imageRect().left).toBeLessThan(beforeDrag - 100);

    await userEvent.click(query("attachment-lightbox-zoom-out"));
    await expect.poll(() => Number.parseInt(zoomLevel(), 10)).toBe(80);
    await userEvent.click(query("attachment-lightbox-zoom-in"));
    await expect.poll(zoomLevel).toBe("100%");

    await userEvent.click(query("attachment-lightbox-fit"));
    await expect.poll(zoomLevel).toBe(`${fitPercent}%`);
    expect(imageRect().width).toBeCloseTo(fittedWidth, 0);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

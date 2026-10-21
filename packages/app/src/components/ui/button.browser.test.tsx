import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text, View } from "react-native";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Button } from "./button";

const mounted: { root: Root; container: HTMLDivElement }[] = [];
const customIconStyle = { width: 32, height: 24 };
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

function geometry(element: HTMLElement) {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function mountButton(props: React.ComponentProps<typeof Button>) {
  const container = document.createElement("div");
  container.style.cssText = "display:inline-flex;align-items:center;gap:12px";
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const render = (loading: boolean) =>
    act(() => {
      root.render(
        <>
          <Button {...props} loading={loading} testID="loading-button">
            移除
          </Button>
          <span data-testid="neighbor">相邻操作</span>
        </>,
      );
    });
  render(false);
  const button = container.querySelector<HTMLElement>('[data-testid="loading-button"]')!;
  const neighbor = container.querySelector<HTMLElement>('[data-testid="neighbor"]')!;
  return { button, neighbor, render };
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("Button loading geometry", () => {
  it("keeps an iconless remove button and its neighbor stationary while blocking repeated presses", () => {
    let presses = 0;
    const { button, neighbor, render } = mountButton({
      variant: "destructive",
      size: "sm",
      onPress: () => {
        presses += 1;
      },
    });
    const original = geometry(button);
    const originalNeighbor = geometry(neighbor);

    render(true);
    expect(geometry(button)).toEqual(original);
    expect(geometry(neighbor)).toEqual(originalNeighbor);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    act(() => button.click());
    expect(presses).toBe(0);

    render(false);
    expect(geometry(button)).toEqual(original);
    expect(geometry(neighbor)).toEqual(originalNeighbor);
    act(() => button.click());
    expect(presses).toBe(1);
  });

  it("preserves the original footprint of a custom icon and trailing content during loading", () => {
    const { button, neighbor, render } = mountButton({
      variant: "outline",
      leftIcon: <View style={customIconStyle} />,
      trailing: <Text>3</Text>,
      style: { gap: 4 },
    });
    const original = geometry(button);
    const originalNeighbor = geometry(neighbor);

    render(true);
    expect(geometry(button)).toEqual(original);
    expect(geometry(neighbor)).toEqual(originalNeighbor);

    render(false);
    expect(geometry(button)).toEqual(original);
    expect(geometry(neighbor)).toEqual(originalNeighbor);
  });
});

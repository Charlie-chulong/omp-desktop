import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Text } from "react-native";
import { userEvent } from "vitest/browser";
import { expect, it } from "vitest";
import { useMenuContext } from "./menu-context";
import { MenuRoot, MenuTrigger } from "./menu-root";

it("captures a press trigger's browser bounds before opening its menu", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let anchor: { x: number; y: number; width: number; height: number } | null = null;
  let open = false;
  function AnchorSnapshot() {
    const context = useMenuContext("AnchorSnapshot");
    anchor = context.anchorRect;
    open = context.open;
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <MenuRoot compactMode="popover">
          <MenuTrigger accessibilityRole="button" testID="menu-trigger">
            <Text>More</Text>
          </MenuTrigger>
          <AnchorSnapshot />
        </MenuRoot>,
      ),
    );

    const trigger = container.querySelector<HTMLElement>('[data-testid="menu-trigger"]')!;
    const rect = trigger.getBoundingClientRect();
    await userEvent.click(trigger);
    await expect.poll(() => open && anchor !== null).toBe(true);
    expect(anchor).toEqual({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

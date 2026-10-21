import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Pressable, Text } from "react-native";
import { userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { FileActionsMenuButton } from "./file-actions-menu";

const menu = vi.hoisted(() => ({ setAnchorRect: vi.fn(), setOpen: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/context-menu", () => ({
  useContextMenu: () => menu,
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
  ContextMenuSeparator: () => null,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("opens the selected row's existing menu without pressing or dragging the row", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onRowPress = vi.fn();
  const onSelect = vi.fn();
  const onPointerDown = vi.fn();
  const onMouseDown = vi.fn();
  try {
    await act(async () =>
      root.render(
        <div onPointerDown={onPointerDown} onMouseDown={onMouseDown}>
          <Pressable onPress={onRowPress}>
            <Text testID="row-label">file.txt</Text>
            <FileActionsMenuButton onSelect={onSelect} testID="file-more" />
          </Pressable>
        </div>,
      ),
    );
    const button = container.querySelector<HTMLElement>('[data-testid="file-more"]')!;
    await userEvent.click(button);
    await expect.poll(() => menu.setOpen.mock.calls.length).toBe(1);
    expect(menu.setOpen).toHaveBeenCalledWith(true);
    expect(menu.setAnchorRect).toHaveBeenCalledWith({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onRowPress).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onMouseDown).not.toHaveBeenCalled();

    await userEvent.click(container.querySelector('[data-testid="row-label"]')!);
    expect(onRowPress).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps an existing browser text selection when opening its visible actions", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <>
          <p data-testid="selection-source">Selected file lines</p>
          <FileActionsMenuButton testID="selection-more" />
        </>,
      ),
    );
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(container.querySelector("p")!);
    selection.removeAllRanges();
    selection.addRange(range);
    await userEvent.click(container.querySelector('[data-testid="selection-more"]')!);
    await expect.poll(() => menu.setOpen.mock.calls.length).toBe(1);
    expect(selection.toString()).toBe("Selected file lines");
  } finally {
    window.getSelection()?.removeAllRanges();
    await act(async () => root.unmount());
    container.remove();
  }
});

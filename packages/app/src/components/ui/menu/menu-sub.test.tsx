import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MenuSubTrigger } from "./menu-sub";

interface PointerInput {
  nativeEvent: { pointerType: string };
}
const state = vi.hoisted(() => ({
  enter: undefined as ((event: PointerInput) => void) | undefined,
  leave: undefined as ((event: PointerInput) => void) | undefined,
  select: undefined as (() => void) | undefined,
  closeOnSelect: undefined as boolean | undefined,
  openSub: vi.fn(),
  hoverOpen: vi.fn(),
  hoverClose: vi.fn(),
  cancelHoverClose: vi.fn(),
}));

vi.mock("react-native", () => ({
  View: ({
    children,
    onPointerEnter,
    onPointerLeave,
  }: React.PropsWithChildren<{
    onPointerEnter?: (event: PointerInput) => void;
    onPointerLeave?: (event: PointerInput) => void;
  }>) => {
    if (onPointerEnter) {
      state.enter = onPointerEnter;
      state.leave = onPointerLeave;
    }
    return <div>{children}</div>;
  },
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("lucide-react-native", () => ({ ChevronRight: () => null }));
vi.mock("./menu-context", () => ({
  useMenuContext: () => ({ presentation: "popover", path: [], openSub: state.openSub }),
  useMenuDepth: () => 0,
}));
vi.mock("./menu-surface", () => ({
  useMenuSurface: () => ({
    registerSubAnchor: vi.fn(),
    hoverOpen: state.hoverOpen,
    hoverClose: state.hoverClose,
    cancelHoverClose: state.cancelHoverClose,
  }),
}));
vi.mock("./menu-item", () => ({
  MenuItem: (props: { onSelect?: () => void; closeOnSelect?: boolean }) => {
    state.select = props.onSelect;
    state.closeOnSelect = props.closeOnSelect;
    return null;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  state.enter = undefined;
  state.leave = undefined;
  renderToStaticMarkup(<MenuSubTrigger id="labels">Labels</MenuSubTrigger>);
});

describe("MenuSubTrigger pointer intent", () => {
  it.each(["touch", "pen"])("does not hover-open for %s", (pointerType) => {
    state.enter?.({ nativeEvent: { pointerType } });
    expect(state.hoverOpen).not.toHaveBeenCalled();
    expect(state.cancelHoverClose).toHaveBeenCalledOnce();
  });

  it("retains mouse hover-open and forwards pointer type for delayed close", () => {
    state.enter?.({ nativeEvent: { pointerType: "mouse" } });
    state.leave?.({ nativeEvent: { pointerType: "mouse" } });
    expect(state.hoverOpen).toHaveBeenCalledWith({ id: "labels", depth: 0 }, "mouse");
    expect(state.hoverClose).toHaveBeenCalledWith(0, "mouse");
  });

  it("cancels hover timers before a tap or keyboard selection and keeps the root menu open", () => {
    state.select?.();
    expect(state.cancelHoverClose).toHaveBeenCalledOnce();
    expect(state.openSub).toHaveBeenCalledWith({ id: "labels", depth: 0 });
    expect(state.closeOnSelect).toBe(false);
    expect(state.cancelHoverClose.mock.invocationCallOrder[0]).toBeLessThan(
      state.openSub.mock.invocationCallOrder[0]!,
    );
  });
});

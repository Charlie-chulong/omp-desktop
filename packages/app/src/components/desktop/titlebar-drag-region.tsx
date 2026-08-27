import { useCallback, useMemo, useRef } from "react";
import type { PointerEvent as NativePointerEvent } from "react-native";
import { getDesktopWindow } from "@/desktop/electron/window";
import type { DesktopWindowBridge } from "@/desktop/host";
import { getIsElectronRuntime } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";

/**
 * VS Code-style titlebar drag region for Electron.
 *
 * Copied from VS Code at commit daa0a70:
 *   - titlebarPart.ts:463-464  → prepend(container, $('div.titlebar-drag-region'))
 *   - titlebarpart.css:57-64   → position: absolute, full size, -webkit-app-region: drag
 *   - titlebarpart.css:249-260 → top-edge resizer, no-drag, 4px
 *
 * VS Code's drag region is a static DOM element — no z-index, no pointer-events,
 * no state, no event listeners. Interactive elements get no-drag from their own
 * CSS (global backstop in index.html). The drag region never re-renders.
 *
 * The resizer is Windows/Linux only (titlebarpart.css:249 scopes to .windows/.linux).
 * On macOS, Electron handles edge resize natively.
 */

/**
 * React Native Web uses dataSet keys verbatim after the `data-` prefix.
 * Keep the hyphens in the key so the DOM attribute matches index.html.
 */
export const TITLEBAR_DRAG_REGION_DATASET = { "window-drag-region": "" } as const;

const TITLEBAR_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role]",
  "[tabindex]",
  '[contenteditable="true"]',
].join(",");

export function useTitlebarWindowDragHandlers() {
  const activePointerRef = useRef<number | null>(null);
  const activeBridgeRef = useRef<DesktopWindowBridge | null>(null);

  const finishWindowDrag = useCallback((event: NativePointerEvent) => {
    if (activePointerRef.current !== event.nativeEvent.pointerId) {
      return;
    }
    activeBridgeRef.current?.endWindowDrag?.();
    activeBridgeRef.current = null;
    activePointerRef.current = null;
    const currentTarget = event.currentTarget as unknown as HTMLElement;
    if (currentTarget.hasPointerCapture?.(event.nativeEvent.pointerId)) {
      currentTarget.releasePointerCapture(event.nativeEvent.pointerId);
    }
  }, []);

  const handleWindowDragPointerDown = useCallback((event: NativePointerEvent) => {
    const target = event.target as unknown;
    if (
      !isWeb ||
      event.nativeEvent.button !== 0 ||
      activePointerRef.current !== null ||
      (target instanceof Element && target.closest(TITLEBAR_INTERACTIVE_SELECTOR) !== null)
    ) {
      return;
    }
    const bridge = getDesktopWindow();
    if (!bridge?.beginWindowDrag || !bridge.moveWindowDrag || !bridge.endWindowDrag) {
      return;
    }

    const pointerId = event.nativeEvent.pointerId;
    const currentTarget = event.currentTarget as unknown as HTMLElement;
    activePointerRef.current = pointerId;
    activeBridgeRef.current = bridge;
    currentTarget.setPointerCapture?.(pointerId);
    event.preventDefault();
    void bridge
      .beginWindowDrag({
        screenX: event.nativeEvent.screenX,
        screenY: event.nativeEvent.screenY,
      })
      .catch(() => {
        if (activePointerRef.current !== pointerId) {
          return;
        }
        activeBridgeRef.current = null;
        activePointerRef.current = null;
        if (currentTarget.hasPointerCapture?.(pointerId)) {
          currentTarget.releasePointerCapture(pointerId);
        }
      });
  }, []);

  const handleWindowDragPointerMove = useCallback(
    (event: NativePointerEvent) => {
      if (activePointerRef.current !== event.nativeEvent.pointerId) {
        return;
      }
      if ((event.nativeEvent.buttons & 1) === 0) {
        finishWindowDrag(event);
        return;
      }
      activeBridgeRef.current?.moveWindowDrag?.({
        screenX: event.nativeEvent.screenX,
        screenY: event.nativeEvent.screenY,
      });
    },
    [finishWindowDrag],
  );

  return useMemo(
    () => ({
      onPointerDown: handleWindowDragPointerDown,
      onPointerMove: handleWindowDragPointerMove,
      onPointerUp: finishWindowDrag,
      onPointerCancel: finishWindowDrag,
    }),
    [finishWindowDrag, handleWindowDragPointerDown, handleWindowDragPointerMove],
  );
}

const DRAG_OVERLAY_STYLE: React.CSSProperties = {
  top: 0,
  left: 0,
  display: "block",
  position: "absolute",
  width: "100%",
  height: "100%",
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "drag",
};

const TOP_RESIZER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  width: "100%",
  height: 4,
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "no-drag",
};

/**
 * Static drag overlay and top-edge resizer. Returns null on non-Electron.
 * Place as FIRST child of any positioned container that should be draggable.
 */
export function TitlebarDragRegion() {
  if (isNative || !getIsElectronRuntime()) {
    return null;
  }

  return (
    <>
      {/* Drag overlay — VS Code .titlebar-drag-region (titlebarpart.css:57-64) */}
      <div style={DRAG_OVERLAY_STYLE} />
      {/* Top-edge resizer — VS Code .resizer (titlebarpart.css:249-256) */}
      <div style={TOP_RESIZER_STYLE} />
    </>
  );
}

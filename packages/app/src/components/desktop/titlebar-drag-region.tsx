import type { CSSProperties } from "react";
import { getIsElectronRuntime } from "@/constants/layout";
import { isNative } from "@/constants/platform";

export const TITLEBAR_DRAG_REGION_DATASET = {
  "window-drag-region": "native",
} as const;

const DRAG_OVERLAY_STYLE: CSSProperties = {
  top: 0,
  left: 0,
  display: "block",
  position: "absolute",
  width: "100%",
  height: "100%",
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "drag",
};

const TOP_RESIZER_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
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
      <div data-window-drag-scope="true" style={DRAG_OVERLAY_STYLE} />
      {/* Top-edge resizer — VS Code .resizer (titlebarpart.css:249-256) */}
      <div style={TOP_RESIZER_STYLE} />
    </>
  );
}

import { describe, expect, it, vi } from "vitest";

import {
  applyMacWindowControlsUpdate,
  applyWindowControlsOverlayUpdate,
  buildStandardContextMenuItems,
  createWindowControlsOverlayState,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  getMainWindowChromeOptions,
  getTitleBarOverlayOptions,
  readBadgeCount,
  readWindowControlsOverlayUpdate,
  readWindowTheme,
  resolveRuntimeTitleBarOverlayOptions,
  resolveWindowBounds,
} from "./window-manager";
import { getDesktopContextMenuLabels } from "../features/context-menu-labels";

describe("window-manager", () => {
  describe("readBadgeCount", () => {
    it("returns valid non-negative integers", () => {
      expect(readBadgeCount(0)).toBe(0);
      expect(readBadgeCount(3)).toBe(3);
    });

    it("falls back to zero for invalid payloads", () => {
      expect(readBadgeCount(undefined)).toBe(0);
      expect(readBadgeCount(null)).toBe(0);
      expect(readBadgeCount(Number.NaN)).toBe(0);
      expect(readBadgeCount(Number.POSITIVE_INFINITY)).toBe(0);
      expect(readBadgeCount(-1)).toBe(0);
      expect(readBadgeCount(1.5)).toBe(0);
      expect(readBadgeCount("2")).toBe(0);
      expect(readBadgeCount({ count: 2 })).toBe(0);
    });
  });

  describe("standard context menu", () => {
    it("keeps Copy Link Address but omits unavailable plain Copy", () => {
      const labels = getDesktopContextMenuLabels();
      const items = buildStandardContextMenuItems(
        {} as Electron.WebContents,
        {
          misspelledWord: "",
          dictionarySuggestions: [],
          linkURL: "https://example.com/path",
          hasImageContents: false,
          srcURL: "",
          isEditable: false,
          editFlags: {},
          selectionText: "",
          x: 0,
          y: 0,
        } as Electron.ContextMenuParams,
      );

      expect(items).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: labels.copyAddress })]),
      );
      expect(items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ label: labels.copy })]),
      );
    });

    it("keeps image actions but omits Paste for a read-only image", () => {
      const labels = getDesktopContextMenuLabels();
      const items = buildStandardContextMenuItems(
        {} as Electron.WebContents,
        {
          misspelledWord: "",
          dictionarySuggestions: [],
          linkURL: "",
          hasImageContents: true,
          srcURL: "https://example.com/image.png",
          isEditable: false,
          editFlags: {},
          selectionText: "",
          x: 12,
          y: 24,
        } as Electron.ContextMenuParams,
      );

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: labels.copyImage }),
          expect.objectContaining({ label: labels.saveImageAs }),
        ]),
      );
      expect(items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ label: labels.paste })]),
      );
    });

    it("keeps Paste availability tied to editable targets", () => {
      const labels = getDesktopContextMenuLabels();
      const params = {
        misspelledWord: "",
        dictionarySuggestions: [],
        linkURL: "",
        hasImageContents: false,
        srcURL: "",
        isEditable: true,
        editFlags: { canCut: false, canCopy: false, canPaste: false },
        selectionText: "",
        x: 0,
        y: 0,
      } as Electron.ContextMenuParams;
      const unavailableItems = buildStandardContextMenuItems({} as Electron.WebContents, params);
      const availableItems = buildStandardContextMenuItems({} as Electron.WebContents, {
        ...params,
        editFlags: { ...params.editFlags, canPaste: true },
      });

      expect(unavailableItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: labels.paste, role: "paste", enabled: false }),
        ]),
      );
      expect(availableItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: labels.paste, role: "paste", enabled: true }),
        ]),
      );
    });
  });

  describe("readWindowTheme", () => {
    it("accepts supported title bar themes", () => {
      expect(readWindowTheme("light")).toBe("light");
      expect(readWindowTheme("dark")).toBe("dark");
    });

    it("rejects invalid title bar themes", () => {
      expect(readWindowTheme(undefined)).toBeNull();
      expect(readWindowTheme("auto")).toBeNull();
      expect(readWindowTheme("system")).toBeNull();
    });
  });

  describe("readWindowControlsOverlayUpdate", () => {
    it("accepts partial runtime overlay updates", () => {
      expect(
        readWindowControlsOverlayUpdate({
          height: 48,
          backgroundColor: "#181B1A",
          trafficLightOffsetY: -5,
        }),
      ).toEqual({
        height: 48,
        backgroundColor: "#181B1A",
        trafficLightOffsetY: -5,
      });
    });

    it("rejects empty and invalid payloads", () => {
      expect(readWindowControlsOverlayUpdate(undefined)).toBeNull();
      expect(readWindowControlsOverlayUpdate({})).toBeNull();
      expect(readWindowControlsOverlayUpdate({ height: 0 })).toBeNull();
      expect(readWindowControlsOverlayUpdate({ backgroundColor: 12 })).toBeNull();
      expect(readWindowControlsOverlayUpdate({ trafficLightOffsetY: -11 })).toBeNull();
    });

    it("preserves fractional traffic-light offsets", () => {
      expect(readWindowControlsOverlayUpdate({ trafficLightOffsetY: 1.5 })).toEqual({
        trafficLightOffsetY: 1.5,
      });
    });
  });

  describe("applyMacWindowControlsUpdate", () => {
    it("uses the focus and normal traffic-light positions", () => {
      const setWindowButtonPosition = vi.fn();

      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: -5 },
      });
      applyMacWindowControlsUpdate({
        win: { setWindowButtonPosition },
        update: { trafficLightOffsetY: 0.5 },
      });

      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(1, { x: 16, y: 9 });
      expect(setWindowButtonPosition).toHaveBeenNthCalledWith(2, { x: 16, y: 14.5 });
    });
  });

  describe("getMainWindowChromeOptions", () => {
    it("uses an opaque native title-bar overlay on windows", () => {
      expect(
        getMainWindowChromeOptions({
          platform: "win32",
          theme: "dark",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        frame: false,
        titleBarOverlay: { color: "#141414", symbolColor: "#e4e4e7", height: 29 },
        autoHideMenuBar: true,
      });
    });

    it("uses the light native overlay palette on linux", () => {
      expect(
        getMainWindowChromeOptions({
          platform: "linux",
          theme: "light",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        frame: false,
        titleBarOverlay: { color: "#f3f3f3", symbolColor: "#141414", height: 29 },
        autoHideMenuBar: true,
      });
    });

    it("keeps the mac traffic-light path separate", () => {
      expect(
        getMainWindowChromeOptions({
          platform: "darwin",
          theme: "dark",
        }),
      ).toEqual({
        titleBarStyle: "hidden",
        titleBarOverlay: true,
        trafficLightPosition: { x: 16, y: 14 },
      });
    });
  });

  describe("native window controls overlay", () => {
    it("applies runtime layout changes without making the title bar translucent", () => {
      const setTitleBarOverlay = vi.fn();
      const current = createWindowControlsOverlayState("dark");

      const next = applyWindowControlsOverlayUpdate({
        win: { setTitleBarOverlay },
        current,
        update: { height: 37, backgroundColor: "#252727" },
      });

      expect(next).toEqual({
        height: 37,
        backgroundColor: "#252727",
        foregroundColor: "#e4e4e7",
      });
      expect(setTitleBarOverlay).toHaveBeenCalledWith({
        color: "#252727",
        symbolColor: "#e4e4e7",
        height: 36,
      });
    });

    it("preserves explicit opaque defaults for both color schemes", () => {
      expect(getTitleBarOverlayOptions("dark").color).toBe("#141414");
      expect(getTitleBarOverlayOptions("light").color).toBe("#f3f3f3");
      expect(
        resolveRuntimeTitleBarOverlayOptions(createWindowControlsOverlayState("light")),
      ).toEqual({
        color: "#f3f3f3",
        symbolColor: "#141414",
        height: 28,
      });
    });
  });

  describe("resolveWindowBounds", () => {
    it("falls back to the default size when no state is saved", () => {
      expect(resolveWindowBounds(null)).toEqual({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
      });
    });

    it("restores the full size and position", () => {
      expect(
        resolveWindowBounds({ x: 120, y: 80, width: 1024, height: 720, isMaximized: false }),
      ).toEqual({ width: 1024, height: 720, x: 120, y: 80 });
    });

    it("omits the position when only the size was persisted", () => {
      expect(resolveWindowBounds({ width: 1024, height: 720, isMaximized: true })).toEqual({
        width: 1024,
        height: 720,
      });
    });
  });
});

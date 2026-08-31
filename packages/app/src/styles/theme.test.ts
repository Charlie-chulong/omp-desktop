import { describe, expect, it } from "vitest";
import {
  baseColors,
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  ompBrandColors,
  THEME_OPTIONS,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("light");
  });

  it("uses the OMP cyan accent across every concrete theme", () => {
    for (const option of THEME_OPTIONS) {
      if (!("theme" in option)) continue;
      const isDark = option.theme.colorScheme === "dark";
      const expectedAccent = isDark ? ompBrandColors.cyan : ompBrandColors.cyanOnLight;
      const expectedForeground = isDark ? baseColors.black : baseColors.white;

      expect(option.theme.colors.accent).toBe(expectedAccent);
      expect(option.theme.colors.accentBright).toBe(expectedAccent);
      expect(option.theme.colors.accentForeground).toBe(expectedForeground);
      expect(option.theme.colors.success).toBe(option.theme.colors.statusSuccess);
    }
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses the global OMP cyan accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe(ompBrandColors.cyan);
    expect(darkPureBlackTheme.colors.accentBright).toBe(ompBrandColors.cyan);
    expect(darkPureBlackTheme.colors.accentForeground).toBe(baseColors.black);
  });

  it("derives sidebar interaction surfaces from the surface scale", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(darkPureBlackTheme.colors.surface1);
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe(
      darkPureBlackTheme.colors.surface2,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Sidebar interaction surfaces", () => {
  it.each([lightTheme, darkTheme])(
    "derives hover and selection from the surface scale",
    (theme) => {
      expect(theme.colors.surfaceSidebarHover).toBe(theme.colors.surface1);
      expect(theme.colors.surfaceSidebarSelected).toBe(theme.colors.surface2);
    },
  );
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});

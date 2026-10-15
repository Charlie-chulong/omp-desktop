import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings/storage";
import { getWallpaperSourceKey, parseRemoteWallpaperSource } from "./source";
import { beginWallpaperLoad, finishWallpaperLoad, getWallpaperLoadStatus } from "./load-state";

describe("wallpaper source", () => {
  it("classifies video URLs from the pathname instead of the query string", () => {
    expect(parseRemoteWallpaperSource("https://cdn.example.com/live.mp4?token=abc#frame")).toEqual({
      key: "url:https://cdn.example.com/live.mp4?token=abc#frame",
      src: "https://cdn.example.com/live.mp4?token=abc#frame",
      kind: "video",
    });
    expect(parseRemoteWallpaperSource("https://cdn.example.com/image.jpg?format=webp")).toEqual({
      key: "url:https://cdn.example.com/image.jpg?format=webp",
      src: "https://cdn.example.com/image.jpg?format=webp",
      kind: "image",
    });
  });

  it("rejects local and executable URL schemes", () => {
    expect(parseRemoteWallpaperSource("file:///C:/secret.png")).toBeNull();
    expect(parseRemoteWallpaperSource("javascript:alert(1)")).toBeNull();
    expect(parseRemoteWallpaperSource("data:image/png;base64,AAAA")).toBeNull();
  });

  it("activates each source only when its own required fields exist", () => {
    expect(
      getWallpaperSourceKey({
        ...DEFAULT_CLIENT_SETTINGS,
        wallpaperEnabled: true,
        wallpaperSource: "url",
        wallpaperPath: "C:/old.png",
        wallpaperUrl: "https://example.com/background.png",
      }),
    ).toBe("url:https://example.com/background.png");
    expect(
      getWallpaperSourceKey({
        ...DEFAULT_CLIENT_SETTINGS,
        wallpaperEnabled: true,
        wallpaperSource: "file",
        wallpaperPath: "C:/wallpapers/background.png",
        wallpaperDir: null,
      }),
    ).toBeNull();
  });

  it("keeps disabled and unselected sources inactive even with retained media fields", () => {
    const settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      wallpaperEnabled: true,
      wallpaperUrl: "https://example.com/background.png",
    };
    expect(getWallpaperSourceKey(settings)).toBeNull();
    expect(getWallpaperSourceKey({ ...settings, wallpaperSource: "url" })).toBe(
      "url:https://example.com/background.png",
    );
    expect(
      getWallpaperSourceKey({ ...settings, wallpaperSource: "url", wallpaperEnabled: false }),
    ).toBeNull();
  });

  it("activates the theme only for loaded media and ignores replaced media events", () => {
    const first = "file:first";
    const second = "url:https://example.com/background.png";
    beginWallpaperLoad(first);
    expect(getWallpaperLoadStatus(first)).toBe("loading");
    finishWallpaperLoad(first, "error");
    expect(getWallpaperLoadStatus(first)).toBe("error");
    beginWallpaperLoad(second);
    finishWallpaperLoad(first, "ready");
    expect(getWallpaperLoadStatus(second)).toBe("loading");
    finishWallpaperLoad(second, "ready");
    expect(getWallpaperLoadStatus(second)).toBe("ready");
    expect(getWallpaperLoadStatus(first)).toBe("loading");
    expect(getWallpaperLoadStatus(null)).toBe("loading");
    beginWallpaperLoad(null);
    expect(getWallpaperLoadStatus(second)).toBe("loading");
  });
});

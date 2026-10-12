import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings/storage";
import { isWallpaperConfigured, parseRemoteWallpaperSource } from "./source";

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
      isWallpaperConfigured({
        ...DEFAULT_CLIENT_SETTINGS,
        wallpaperEnabled: true,
        wallpaperSource: "url",
        wallpaperPath: "C:/old.png",
        wallpaperUrl: "https://example.com/background.png",
      }),
    ).toBe(true);
    expect(
      isWallpaperConfigured({
        ...DEFAULT_CLIENT_SETTINGS,
        wallpaperEnabled: true,
        wallpaperSource: "file",
        wallpaperPath: "C:/wallpapers/background.png",
        wallpaperDir: null,
      }),
    ).toBe(false);
  });
});

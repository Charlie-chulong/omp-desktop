import { describe, expect, it } from "vitest";
import { buildWallpaperMediaSrc } from "./media-src";

describe("buildWallpaperMediaSrc", () => {
  it("uses only the main-process capability in the renderer URL", () => {
    const source = buildWallpaperMediaSrc("opaque/id with spaces");

    expect(source).toBe("omp-desktop://app/wallpaper-media?id=opaque%2Fid%20with%20spaces");
    expect(source).not.toContain("path=");
  });
});

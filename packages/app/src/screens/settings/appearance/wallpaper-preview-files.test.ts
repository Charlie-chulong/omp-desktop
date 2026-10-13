import { describe, expect, it } from "vitest";
import type { WallpaperMediaDescriptor } from "@/wallpaper/types";
import {
  COLLAPSED_WALLPAPER_PREVIEW_COUNT,
  selectWallpaperPreviewFiles,
} from "./wallpaper-preview-files";

const files: WallpaperMediaDescriptor[] = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  path: `C:/wallpapers/${index}.jpg`,
  name: `${index}.jpg`,
  kind: "image",
}));

describe("selectWallpaperPreviewFiles", () => {
  it("keeps a selected wallpaper visible in the bounded collapsed grid", () => {
    const visible = selectWallpaperPreviewFiles(files, files[10].path, false);

    expect(visible).toHaveLength(COLLAPSED_WALLPAPER_PREVIEW_COUNT);
    expect(visible.at(-1)).toBe(files[10]);
  });

  it("returns every bounded backend result only after expansion", () => {
    expect(selectWallpaperPreviewFiles(files, null, true)).toEqual(files);
  });
});

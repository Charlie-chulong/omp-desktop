import type { WallpaperMediaDescriptor } from "@/wallpaper/types";

export const COLLAPSED_WALLPAPER_PREVIEW_COUNT = 8;

export function selectWallpaperPreviewFiles(
  files: WallpaperMediaDescriptor[],
  selectedPath: string | null,
  expanded: boolean,
): WallpaperMediaDescriptor[] {
  if (expanded || files.length <= COLLAPSED_WALLPAPER_PREVIEW_COUNT) return files;

  const visible = files.slice(0, COLLAPSED_WALLPAPER_PREVIEW_COUNT);
  const selected = files.find((file) => file.path === selectedPath);
  if (!selected || visible.includes(selected)) return visible;

  return [...visible.slice(0, COLLAPSED_WALLPAPER_PREVIEW_COUNT - 1), selected];
}

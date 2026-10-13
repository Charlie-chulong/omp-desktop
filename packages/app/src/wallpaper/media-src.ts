/**
 * Local wallpaper bytes are exposed through an opaque capability issued by
 * the Electron main process. The URL never contains a filesystem path.
 */
export function buildWallpaperMediaSrc(mediaId: string): string {
  if (!mediaId) return "";
  return `omp-desktop://app/wallpaper-media?id=${encodeURIComponent(mediaId)}`;
}

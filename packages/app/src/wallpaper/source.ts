import type { AppSettings } from "@/hooks/use-settings";
import type { WallpaperMediaKind } from "./types";

const VIDEO_EXTENSIONS: Record<string, true> = {
  ".mp4": true,
  ".webm": true,
  ".m4v": true,
  ".mov": true,
  ".ogv": true,
};

export interface RemoteWallpaperSource {
  key: string;
  src: string;
  kind: WallpaperMediaKind;
}

export function isWallpaperConfigured(settings: AppSettings): boolean {
  if (!settings.wallpaperEnabled) return false;
  if (settings.wallpaperSource === "file") {
    return Boolean(settings.wallpaperDir && settings.wallpaperPath);
  }
  if (settings.wallpaperSource === "url") {
    return parseRemoteWallpaperSource(settings.wallpaperUrl) !== null;
  }
  return false;
}

export function parseRemoteWallpaperSource(value: string | null): RemoteWallpaperSource | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const pathname = url.pathname.toLowerCase();
    const dot = pathname.lastIndexOf(".");
    const extension = dot >= 0 ? pathname.slice(dot) : "";
    return {
      key: `url:${url.href}`,
      src: url.href,
      kind: VIDEO_EXTENSIONS[extension] ? "video" : "image",
    };
  } catch {
    return null;
  }
}

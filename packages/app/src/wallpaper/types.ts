export type WallpaperMediaKind = "image" | "video";

export interface WallpaperMediaDescriptor {
  id: string;
  path: string;
  name: string;
  kind: WallpaperMediaKind;
}

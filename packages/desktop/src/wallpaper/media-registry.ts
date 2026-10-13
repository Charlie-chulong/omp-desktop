import { randomUUID } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type WallpaperMediaKind = "image" | "video";

export interface WallpaperMediaDescriptor {
  id: string;
  path: string;
  name: string;
  kind: WallpaperMediaKind;
}

export interface RegisteredWallpaperMedia extends WallpaperMediaDescriptor {
  mime: string;
}

const WALLPAPER_MEDIA_TYPES: Record<string, { kind: WallpaperMediaKind; mime: string }> = {
  ".jpg": { kind: "image", mime: "image/jpeg" },
  ".jpeg": { kind: "image", mime: "image/jpeg" },
  ".png": { kind: "image", mime: "image/png" },
  ".gif": { kind: "image", mime: "image/gif" },
  ".webp": { kind: "image", mime: "image/webp" },
  ".bmp": { kind: "image", mime: "image/bmp" },
  ".avif": { kind: "image", mime: "image/avif" },
  ".mp4": { kind: "video", mime: "video/mp4" },
  ".m4v": { kind: "video", mime: "video/mp4" },
  ".webm": { kind: "video", mime: "video/webm" },
  ".mov": { kind: "video", mime: "video/quicktime" },
  ".ogv": { kind: "video", mime: "video/ogg" },
};

export const MAX_WALLPAPER_DIRECTORY_ENTRIES = 48;
const MAX_REGISTERED_WALLPAPER_MEDIA = 256;

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function readSupportedMedia(filePath: string): { kind: WallpaperMediaKind; mime: string } | null {
  return WALLPAPER_MEDIA_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

export class WallpaperMediaRegistry {
  private readonly byId = new Map<string, RegisteredWallpaperMedia>();
  private readonly idByPath = new Map<string, string>();

  async scanDirectory(directory: string): Promise<WallpaperMediaDescriptor[]> {
    const root = await this.readDirectory(directory);
    if (!root) return [];

    try {
      const entries = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && readSupportedMedia(entry.name) !== null)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
        )
        .slice(0, MAX_WALLPAPER_DIRECTORY_ENTRIES);
      const descriptors = await Promise.all(
        entries.map((entry) => this.registerWithinRoot(root, path.join(root, entry.name))),
      );
      return descriptors.filter(
        (descriptor): descriptor is WallpaperMediaDescriptor => descriptor !== null,
      );
    } catch {
      return [];
    }
  }

  async resolveFile(input: {
    directory?: unknown;
    path?: unknown;
  }): Promise<WallpaperMediaDescriptor | null> {
    if (typeof input.directory !== "string" || typeof input.path !== "string") return null;
    const root = await this.readDirectory(input.directory);
    if (!root) return null;
    return this.registerWithinRoot(root, input.path);
  }

  get(id: string): RegisteredWallpaperMedia | null {
    return this.byId.get(id) ?? null;
  }

  private async readDirectory(directory: string): Promise<string | null> {
    if (!directory) return null;
    try {
      const canonicalPath = await realpath(directory);
      return (await stat(canonicalPath)).isDirectory() ? canonicalPath : null;
    } catch {
      return null;
    }
  }

  private async registerWithinRoot(
    root: string,
    requestedPath: string,
  ): Promise<WallpaperMediaDescriptor | null> {
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(requestedPath);
      if (!(await stat(canonicalPath)).isFile()) return null;
    } catch {
      return null;
    }
    if (!isPathInside(root, canonicalPath)) return null;
    const media = readSupportedMedia(canonicalPath);
    if (!media) return null;

    const existingId = this.idByPath.get(canonicalPath);
    if (existingId) {
      const existing = this.byId.get(existingId);
      if (existing) return existing;
      this.idByPath.delete(canonicalPath);
    }

    while (this.byId.size >= MAX_REGISTERED_WALLPAPER_MEDIA) {
      const oldestId = this.byId.keys().next().value as string | undefined;
      if (!oldestId) break;
      const oldest = this.byId.get(oldestId);
      this.byId.delete(oldestId);
      if (oldest) this.idByPath.delete(oldest.path);
    }

    const id = randomUUID();
    const entry: RegisteredWallpaperMedia = {
      id,
      path: canonicalPath,
      name: path.basename(canonicalPath),
      kind: media.kind,
      mime: media.mime,
    };
    this.byId.set(id, entry);
    this.idByPath.set(canonicalPath, id);
    return entry;
  }
}

export const wallpaperMediaRegistry = new WallpaperMediaRegistry();

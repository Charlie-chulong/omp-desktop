import { open, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { expandUserPath, resolvePathFromBase } from "../../path-utils.js";

export const MAX_PRESENT_IMAGE_BYTES = 32 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PresentImageInspection {
  filePath: string;
  mimeType: string;
}

export function resolvePresentImagePath(input: { path: string; cwd?: string | null }): string {
  const normalized = normalizePresentImagePath(input.path);
  if (!normalized) {
    throw new Error("path is required");
  }
  const cwd = input.cwd?.trim();
  if (cwd) {
    return resolvePathFromBase(cwd, normalized);
  }
  if (normalized === "~" || normalized.startsWith("~/") || isAbsolute(normalized)) {
    return expandUserPath(normalized);
  }
  throw new Error("path must be absolute when the caller workspace is unknown");
}

export async function inspectPresentImage(filePath: string): Promise<PresentImageInspection> {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".svg") {
    throw new Error("present_image only publishes raster images, not SVG");
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new Error(`Image not found: ${filePath}`);
    }
    throw error;
  }
  if (!fileStats.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (fileStats.size <= 0) {
    throw new Error(`File is not a raster image: ${filePath}`);
  }
  if (fileStats.size > MAX_PRESENT_IMAGE_BYTES) {
    throw new Error(
      `Image is too large to publish (${fileStats.size} bytes; max ${MAX_PRESENT_IMAGE_BYTES})`,
    );
  }

  const sample = Buffer.alloc(Math.min(16, fileStats.size));
  const handle = await open(filePath, "r");
  try {
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    const mimeType = sniffRasterImageMimeType(sample.subarray(0, bytesRead));
    if (!mimeType) {
      throw new Error(`File is not a raster image: ${filePath}`);
    }
    return { filePath, mimeType };
  } finally {
    await handle.close();
  }
}

function normalizePresentImagePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (!/^file:/i.test(trimmed)) {
    return trimmed;
  }
  try {
    return fileURLToPath(trimmed);
  } catch {
    return trimmed.replace(/^file:\/\//i, "");
  }
}

function sniffRasterImageMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  return null;
}

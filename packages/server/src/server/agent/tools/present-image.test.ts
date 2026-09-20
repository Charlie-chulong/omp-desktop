import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { inspectPresentImage, resolvePresentImagePath } from "./present-image.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "paseo-present-image-"));
  tempDirs.push(dir);
  return dir;
}

describe("present_image helpers", () => {
  it("resolves relative paths against the caller workspace", () => {
    expect(resolvePresentImagePath({ path: "qr.png", cwd: "/workspace" })).toBe(
      path.resolve("/workspace", "qr.png"),
    );
  });

  it("resolves file URLs and absolute paths without a workspace", () => {
    const filePath = path.join(tmpdir(), "qr.png");
    expect(resolvePresentImagePath({ path: filePath })).toBe(path.resolve(filePath));
    expect(resolvePresentImagePath({ path: pathToFileURL(filePath).href })).toBe(
      path.resolve(filePath),
    );
  });

  it("rejects relative paths when the caller workspace is unknown", () => {
    expect(() => resolvePresentImagePath({ path: "qr.png" })).toThrow(
      "path must be absolute when the caller workspace is unknown",
    );
  });

  it("inspects a PNG as a raster image", async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, "qr.png");
    await writeFile(filePath, PNG_1X1);

    await expect(inspectPresentImage(filePath)).resolves.toEqual({
      filePath,
      mimeType: "image/png",
    });
  });

  it("rejects missing, SVG, and non-image files", async () => {
    const dir = await makeTempDir();
    const missingPath = path.join(dir, "missing.png");
    const svgPath = path.join(dir, "logo.svg");
    const textPath = path.join(dir, "notes.txt");
    await writeFile(svgPath, "<svg xmlns='http://www.w3.org/2000/svg'></svg>\n");
    await writeFile(textPath, "not an image\n");

    await expect(inspectPresentImage(missingPath)).rejects.toThrow(
      `Image not found: ${missingPath}`,
    );
    await expect(inspectPresentImage(svgPath)).rejects.toThrow("not SVG");
    await expect(inspectPresentImage(textPath)).rejects.toThrow("not a raster image");
  });
});

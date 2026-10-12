import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { persistOmpImageOutputs } from "./image-output.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aShoAAAAASUVORK5CYII=";
const webp = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

describe("native generated image persistence", () => {
  test("uses actual WebP bytes for hosted subscription output and ignores misleading MIME", () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-webp-"));
    try {
      const bytes = Buffer.from(webp, "base64");
      const output = persistOmpImageOutputs([{ data: webp, mimeType: "image/png" }], [], directory);
      expect(output).toEqual([
        {
          index: 0,
          filePath: join(
            directory,
            "generated-images",
            `${createHash("sha256").update(bytes).digest("hex")}.webp`,
          ),
          mimeType: "image/webp",
        },
      ]);
      expect(readFileSync(output[0]!.filePath)).toEqual(bytes);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rebuilds a preview from a native blob reference after temporary and preview cleanup", () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-native-blob-"));
    try {
      const bytes = Buffer.from(png, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      writeFileSync(join(directory, hash), bytes);
      const images = [{ data: `blob:sha256:${hash}`, mimeType: "image/png" }];
      const output = persistOmpImageOutputs(images, ["/deleted/native-temp.png"], directory);
      expect(readFileSync(output[0]!.filePath)).toEqual(bytes);
      rmSync(output[0]!.filePath);
      const replayed = persistOmpImageOutputs(images, ["/deleted/native-temp.png"], directory);
      expect(replayed[0]?.filePath).toBe(output[0]!.filePath);
      expect(readFileSync(replayed[0]!.filePath)).toEqual(bytes);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("prefers returned bytes over a conflicting transient file", () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-image-bytes-"));
    try {
      const temporaryPath = join(directory, "native.png");
      writeFileSync(temporaryPath, Buffer.from(webp, "base64"));
      const output = persistOmpImageOutputs(
        [{ data: png, mimeType: "image/png" }],
        [temporaryPath],
        directory,
      );
      expect(output[0]?.mimeType).toBe("image/png");
      expect(readFileSync(output[0]!.filePath)).toEqual(Buffer.from(png, "base64"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects invalid encodings and non-image bytes without leaking a temporary preview", () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-invalid-image-"));
    try {
      expect(
        persistOmpImageOutputs(
          [
            { data: `${png}!`, mimeType: "image/png" },
            { data: Buffer.from("not an image").toString("base64"), mimeType: "image/png" },
            { data: "", mimeType: "image/png" },
          ],
          ["/missing/one.png", "/missing/two.png", "/missing/three.png"],
          directory,
        ),
      ).toEqual([]);
      const blockedDirectory = join(directory, "not-a-directory");
      writeFileSync(blockedDirectory, "file");
      expect(
        persistOmpImageOutputs(
          [{ data: png, mimeType: "image/png" }],
          ["/missing/native.png"],
          blockedDirectory,
        ),
      ).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("keeps output indexes when only a later image is available", () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-image-index-"));
    try {
      const output = persistOmpImageOutputs(
        [null, { data: png, mimeType: "image/png" }],
        [],
        directory,
      );
      expect(output).toHaveLength(1);
      expect(output[0]?.index).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

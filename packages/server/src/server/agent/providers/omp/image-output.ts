import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface OmpImageOutput {
  index: number;
  filePath: string;
  mimeType: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Native details retain bytes; path references also survive replay after native temp cleanup. */
export function persistOmpImageOutputs(
  images: unknown,
  imagePaths: unknown,
  outputDir?: string,
): OmpImageOutput[] {
  const returnedImages = Array.isArray(images) ? images : [];
  const paths = Array.isArray(imagePaths) ? imagePaths : [];
  const outputs: OmpImageOutput[] = [];
  const directory = outputDir ? join(outputDir, "generated-images") : undefined;
  for (let index = 0; index < Math.max(returnedImages.length, paths.length); index++) {
    const image = returnedImages[index];
    const sourcePath = typeof paths[index] === "string" ? paths[index] : undefined;
    let bytes: Buffer | undefined;
    if (image && typeof image === "object" && typeof image.data === "string") {
      const data = image.data.trim();
      const blob = /^blob:sha256:([a-f0-9]{64})$/.exec(data);
      if (blob && outputDir) {
        try {
          bytes = readFileSync(join(outputDir, blob[1]!));
        } catch {
          bytes = undefined;
        }
      } else if (data.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data) && data.length % 4 !== 1) {
        const decoded = Buffer.from(data, "base64");
        if (decoded.toString("base64").replace(/=+$/, "") === data.replace(/=+$/, "")) {
          bytes = decoded;
        }
      }
    }
    if ((!bytes || !sniffImageMimeType(bytes)) && sourcePath) {
      try {
        bytes = readFileSync(sourcePath);
      } catch {
        bytes = undefined;
      }
    }
    const mimeType = bytes ? sniffImageMimeType(bytes) : null;
    if (bytes && mimeType) {
      try {
        if (!directory) {
          // Never emit base64 into a tool card; production callers supply the blob directory.
          if (sourcePath && existsSync(sourcePath))
            outputs.push({ index, filePath: sourcePath, mimeType });
          continue;
        }
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const name = `${createHash("sha256").update(bytes).digest("hex")}.${IMAGE_EXTENSIONS[mimeType]}`;
        const filePath = join(directory, name);
        if (!existsSync(filePath)) writePrivateFile(filePath, bytes);
        outputs.push({ index, filePath, mimeType });
        if (sourcePath) {
          const references = join(directory, "references");
          mkdirSync(references, { recursive: true, mode: 0o700 });
          const reference = join(
            references,
            `${createHash("sha256").update(sourcePath).digest("hex")}.json`,
          );
          const metadata = JSON.stringify({ name, mimeType });
          let previous: string | undefined;
          try {
            previous = readFileSync(reference, "utf8");
          } catch {
            // The first mapping has no reference yet.
          }
          if (previous !== metadata) writePrivateFile(reference, metadata);
        }
      } catch {
        // Persistence failure must not turn generation into a broken temporary preview.
      }
      continue;
    }
    if (directory && sourcePath) {
      try {
        const reference = join(
          directory,
          "references",
          `${createHash("sha256").update(sourcePath).digest("hex")}.json`,
        );
        const saved: unknown = JSON.parse(readFileSync(reference, "utf8"));
        if (
          saved &&
          typeof saved === "object" &&
          "name" in saved &&
          "mimeType" in saved &&
          typeof saved.name === "string" &&
          /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(saved.name) &&
          typeof saved.mimeType === "string" &&
          IMAGE_EXTENSIONS[saved.mimeType]
        ) {
          const filePath = join(directory, saved.name);
          if (existsSync(filePath)) outputs.push({ index, filePath, mimeType: saved.mimeType });
        }
      } catch {
        // Missing or invalid cache entries are unavailable images, not successful previews.
      }
    }
  }
  return outputs;
}

function sniffImageMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  const header = bytes.toString("ascii", 0, 6);
  if (bytes.length >= 10 && (header === "GIF87a" || header === "GIF89a")) return "image/gif";
  if (
    bytes.length >= 20 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function writePrivateFile(path: string, content: Buffer | string): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

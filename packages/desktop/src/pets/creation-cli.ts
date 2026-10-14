import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, net, protocol } from "electron";
import { getPetLibrary } from "./library.js";
import {
  MAX_PET_IMAGE_BYTES,
  MAX_PET_MANIFEST_BYTES,
  parsePetManifest,
  validatePetSheet,
} from "./manifest.js";

async function convertGeneratedAtlas(imagePath: string): Promise<Buffer> {
  const info = await lstat(imagePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PET_IMAGE_BYTES) {
    throw new TypeError("Generated pet image must be a regular image file no larger than 20 MiB.");
  }
  // Chromium decodes the actual bytes, including WebP returned by image tools.
  // nativeImage's platform-dependent path decoders need not support that format.
  protocol.handle("omp-desktop", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("Not found", { status: 404 });
    if (url.pathname === "/pet-author-image") return net.fetch(pathToFileURL(imagePath).toString());
    if (url.pathname === "/pet-author-convert") {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>OMP pet image conversion</title>',
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'none'; img-src 'self'",
          },
        },
      );
    }
    return new Response("Not found", { status: 404 });
  });
  const window = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    await window.loadURL("omp-desktop://app/pet-author-convert");
    const png: unknown = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      const { promise, resolve, reject } = Promise.withResolvers();
      image.onload = resolve;
      image.onerror = () => reject(new Error("Cannot decode the generated pet image."));
      image.src = "omp-desktop://app/pet-author-image";
      await promise;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height || width > 4096 || height > 4096) throw new Error("Pet image dimensions must not exceed 4096 × 4096 pixels.");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Pet image conversion cannot create a drawing context.");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height);
      const rgba = pixels.data;
      let alreadyTransparent = false;
      for (let index = 3; index < rgba.length; index += 4) {
        if (rgba[index] < 255) { alreadyTransparent = true; break; }
      }
      if (!alreadyTransparent) {
        let keyed = false;
        for (let index = 0; index < rgba.length; index += 4) {
          const red = rgba[index];
          const green = rgba[index + 1];
          const blue = rgba[index + 2];
          const dominance = green - Math.max(red, blue);
          if (green > 100 && dominance > 30) { rgba[index + 3] = 0; keyed = true; }
          else if (green > 80 && dominance > 5) rgba[index + 1] = Math.max(red, blue);
        }
        if (!keyed) throw new Error("Generate a transparent image or use a flat #00FF00 background before installing the pet.");
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
    })()`);
    if (typeof png !== "string" || !png)
      throw new TypeError("Pet image conversion returned no PNG data.");
    const result = Buffer.from(png, "base64");
    if (result.length > MAX_PET_IMAGE_BYTES)
      throw new TypeError("Converted pet spritesheet exceeds 20 MiB.");
    return result;
  } finally {
    window.destroy();
    protocol.unhandle("omp-desktop");
  }
}

export async function tryRunPetCreationCli(): Promise<boolean> {
  const marker = process.argv.indexOf("--desktop-pet-install");
  if (marker === -1) return false;
  try {
    const argument = process.argv[marker + 1];
    if (!argument)
      throw new TypeError("--desktop-pet-install requires the path to a complete pet.json.");
    const manifestPath = path.resolve(argument);
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PET_MANIFEST_BYTES) {
      throw new TypeError("pet.json must be a regular file no larger than 64 KiB.");
    }
    const manifest = parsePetManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
    await app.whenReady();
    const imageMarker = process.argv.indexOf("--input-image", marker + 2);
    if (imageMarker !== -1) {
      const imageArgument = process.argv[imageMarker + 1];
      if (!imageArgument)
        throw new TypeError("--input-image requires the actual generated image path.");
      const spritePath = path.join(path.dirname(manifestPath), manifest.spritesheet);
      try {
        if ((await lstat(spritePath)).isSymbolicLink())
          throw new TypeError("Cannot replace a symbolic-link spritesheet.");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const data = await convertGeneratedAtlas(path.resolve(imageArgument));
      validatePetSheet(data, manifest);
      await writeFile(spritePath, data);
    }
    const pet = await getPetLibrary().importDirectory(path.dirname(manifestPath));
    console.log(JSON.stringify(pet));
    app.exit(0);
  } catch (error) {
    console.error(`[pet creation] ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  }
  return true;
}

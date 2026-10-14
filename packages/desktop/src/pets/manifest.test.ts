import { describe, expect, it } from "vitest";
import { parsePetManifest, validatePetSheet } from "./manifest.js";

const manifest = {
  version: 1,
  name: "Garden fox",
  spritesheet: "sprites.png",
  frameWidth: 32,
  frameHeight: 32,
  animations: {
    idle: { row: 0, frames: 4, fps: 2 },
    running: { row: 1, frames: 4, fps: 5 },
    needs_input: { row: 2, frames: 4, fps: 2 },
    ready: { row: 3, frames: 4, fps: 3 },
    blocked: { row: 4, frames: 4, fps: 2 },
  },
};

function pngHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

describe("custom pet package boundaries", () => {
  it.each(["../private.png", "/private.png", "subdir/sprites.png", "sprite.svg", "sprite.html"])(
    "rejects traversal and executable spritesheet names: %s",
    (spritesheet) => {
      expect(() => parsePetManifest({ ...manifest, spritesheet })).toThrow("Invalid pet.json");
    },
  );

  it("rejects packages without a needs-input animation rather than inventing one", () => {
    const { needs_input: _unused, ...animations } = manifest.animations;
    expect(() => parsePetManifest({ ...manifest, animations })).toThrow("needs_input");
  });

  it("rejects scripts and unsupported package versions", () => {
    expect(() => parsePetManifest({ ...manifest, script: "run.js" })).toThrow("Invalid pet.json");
    expect(() => parsePetManifest({ ...manifest, version: 2 })).toThrow("version");
  });

  it("rejects a row beyond the actual atlas instead of showing another frame", () => {
    expect(() => validatePetSheet(pngHeader(128, 128), parsePetManifest(manifest))).toThrow(
      "blocked",
    );
  });

  it("rejects frames beyond the atlas width and partial frame tiles", () => {
    expect(() => validatePetSheet(pngHeader(96, 160), parsePetManifest(manifest))).toThrow("idle");
    expect(() => validatePetSheet(pngHeader(127, 160), parsePetManifest(manifest))).toThrow(
      "whole frames",
    );
  });

  it("rejects decompression-sized dimensions before image decoding", () => {
    expect(() => validatePetSheet(pngHeader(65536, 160), parsePetManifest(manifest))).toThrow(
      "4096",
    );
    expect(() => validatePetSheet(Buffer.from("not a PNG"), parsePetManifest(manifest))).toThrow(
      "PNG",
    );
  });
});

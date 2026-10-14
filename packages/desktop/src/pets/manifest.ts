import { z } from "zod";
import type { PetManifest } from "./types.js";

export const MAX_PET_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PET_MANIFEST_BYTES = 64 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const animationSchema = z
  .object({
    row: z.number().int().min(0).max(127),
    frames: z.number().int().min(1).max(128),
    fps: z.number().min(1).max(30),
  })
  .strict();
const manifestSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    spritesheet: z.string().regex(/^[a-zA-Z0-9_-]+\.png$/),
    frameWidth: z.number().int().min(16).max(1024),
    frameHeight: z.number().int().min(16).max(1024),
    animations: z
      .object({
        idle: animationSchema,
        running: animationSchema,
        needs_input: animationSchema,
        ready: animationSchema,
        blocked: animationSchema,
        dragging: animationSchema.optional(),
      })
      .strict(),
  })
  .strict();

export function parsePetManifest(value: unknown): PetManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(
      `Invalid pet.json: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return result.data;
}

export function validatePetSheet(
  data: Buffer,
  manifest: PetManifest,
): { width: number; height: number } {
  if (
    data.length > MAX_PET_IMAGE_BYTES ||
    data.length < 33 ||
    !data.subarray(0, 8).equals(PNG_SIGNATURE) ||
    data.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new TypeError("Pet spritesheet must be a PNG no larger than 20 MiB.");
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width % manifest.frameWidth !== 0 ||
    height % manifest.frameHeight !== 0
  ) {
    throw new TypeError("Pet spritesheet must fit a 4096 × 4096 image and contain whole frames.");
  }
  const columns = width / manifest.frameWidth;
  const rows = height / manifest.frameHeight;
  for (const [state, animation] of Object.entries(manifest.animations)) {
    if (animation.row >= rows || animation.frames > columns) {
      throw new TypeError(`Pet animation ${state} extends outside the spritesheet.`);
    }
  }
  return { width, height };
}

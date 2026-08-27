import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

const DaemonIdentitySchema = z.object({
  v: z.literal(1),
  publicKeyB64: z.string().min(1),
});

const IDENTITY_FILENAME = "daemon-identity.json";

export interface DaemonIdentityBundle {
  publicKeyB64: string;
}

export async function loadOrCreateDaemonKeyPair(
  paseoHome: string,
  logger?: pino.Logger,
): Promise<DaemonIdentityBundle> {
  const log = logger?.child({ module: "daemon-identity" });
  const filePath = path.join(paseoHome, IDENTITY_FILENAME);

  if (existsSync(filePath)) {
    try {
      ensurePrivateFile(filePath);
      const parsed = DaemonIdentitySchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      log?.info({ filePath }, "Loaded daemon identity");
      return { publicKeyB64: parsed.publicKeyB64 };
    } catch (error) {
      log?.warn({ err: error, filePath }, "Failed to load daemon identity, regenerating");
    }
  }

  const publicKeyB64 = randomBytes(32).toString("base64");
  const payload = DaemonIdentitySchema.parse({ v: 1, publicKeyB64 });
  writePrivateFileAtomicSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  log?.info({ filePath }, "Saved daemon identity");
  return { publicKeyB64 };
}

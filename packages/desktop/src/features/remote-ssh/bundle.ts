import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { z } from "zod";

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  backendVersion: z.string().min(1),
  nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  supportedTargets: z.array(z.string()),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
});

export interface RemoteBackendFile {
  relativePath: string;
  contents: Buffer;
}

export interface RemoteBackendBundle {
  backendVersion: string;
  nodeVersion: string;
  supportedTargets: readonly string[];
  files: readonly RemoteBackendFile[];
}

function resolveBundleDirectory(): string {
  if (process.env.PASEO_REMOTE_BACKEND_DIR?.trim()) {
    return path.resolve(process.env.PASEO_REMOTE_BACKEND_DIR.trim());
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "remote-backend");
  }
  return path.resolve(__dirname, "..", "..", "..", "remote-backend-dist");
}

export async function loadRemoteBackendBundle(): Promise<RemoteBackendBundle> {
  const directory = resolveBundleDirectory();
  let manifest: z.infer<typeof ManifestSchema>;
  try {
    manifest = ManifestSchema.parse(
      JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")),
    );
  } catch (error) {
    throw new Error(
      `Remote backend bundle is unavailable. Run npm run build:remote-backend. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const files: RemoteBackendFile[] = [];
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const absolutePath = path.resolve(directory, relativePath);
    if (!absolutePath.startsWith(`${directory}${path.sep}`)) {
      throw new Error(`Remote backend manifest contains an unsafe path: ${relativePath}`);
    }
    const contents = await readFile(absolutePath);
    const actualHash = createHash("sha256").update(contents).digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error(`Remote backend bundle checksum mismatch: ${relativePath}`);
    }
    files.push({ relativePath, contents });
  }

  return {
    backendVersion: manifest.backendVersion,
    nodeVersion: manifest.nodeVersion,
    supportedTargets: manifest.supportedTargets,
    files,
  };
}

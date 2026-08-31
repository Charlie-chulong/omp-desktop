import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePaseoHome } from "@omp-desktop/server";

const ATTACHMENTS_DIRNAME = "desktop-attachments";
const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const EXTENSION_PATTERN = /^\.[A-Za-z0-9]{1,16}$/;

interface AttachmentFileResult {
  path: string;
  byteSize: number;
}

export class ManagedAttachmentReferenceRegistry {
  private readonly referencedIdsByOwner = new Map<number, Set<string>>();

  public update(input: {
    ownerId: number;
    activeOwnerIds: readonly number[];
    referencedIds: readonly string[];
  }): Set<string> | null {
    const activeOwnerIds = new Set(input.activeOwnerIds);
    for (const ownerId of this.referencedIdsByOwner.keys()) {
      if (!activeOwnerIds.has(ownerId)) {
        this.referencedIdsByOwner.delete(ownerId);
      }
    }

    if (!activeOwnerIds.has(input.ownerId)) {
      return null;
    }
    this.referencedIdsByOwner.set(input.ownerId, new Set(input.referencedIds));

    for (const ownerId of activeOwnerIds) {
      if (!this.referencedIdsByOwner.has(ownerId)) {
        return null;
      }
    }

    const referencedIds = new Set<string>();
    for (const ownerIds of this.referencedIdsByOwner.values()) {
      for (const id of ownerIds) {
        referencedIds.add(id);
      }
    }
    return referencedIds;
  }
}

function attachmentsDirPath(): string {
  return path.join(resolvePaseoHome(process.env), ATTACHMENTS_DIRNAME);
}

async function ensureAttachmentsDir(): Promise<string> {
  const dirPath = attachmentsDirPath();
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

function normalizeAttachmentId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Attachment id is required.");
  }
  const normalized = value.trim();
  if (!ATTACHMENT_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid attachment id: ${value}`);
  }
  return normalized;
}

function normalizeExtension(value: unknown): string {
  if (value == null || value === "") {
    return ".bin";
  }
  if (typeof value !== "string") {
    throw new Error("Attachment extension must be a string.");
  }
  const normalized = value.trim().toLowerCase();
  const extension = normalized.startsWith(".") ? normalized : `.${normalized}`;
  if (!EXTENSION_PATTERN.test(extension)) {
    throw new Error(`Invalid attachment extension: ${value}`);
  }
  return extension;
}

async function buildManagedAttachmentPath(input: {
  attachmentId: unknown;
  extension: unknown;
}): Promise<string> {
  const dirPath = await ensureAttachmentsDir();
  const attachmentId = normalizeAttachmentId(input.attachmentId);
  const extension = normalizeExtension(input.extension);
  return path.join(dirPath, `${attachmentId}${extension}`);
}

function resolveManagedAttachmentPath(inputPath: unknown): string {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
    throw new Error("Attachment path is required.");
  }
  const resolvedDir = `${path.resolve(attachmentsDirPath())}${path.sep}`;
  const resolvedPath = path.resolve(inputPath.trim());
  if (!resolvedPath.startsWith(resolvedDir)) {
    throw new Error("Attachment path must stay within desktop-managed storage.");
  }
  return resolvedPath;
}

export async function writeAttachmentBase64(input: {
  attachmentId?: unknown;
  base64?: unknown;
  extension?: unknown;
}): Promise<AttachmentFileResult> {
  const base64 = typeof input.base64 === "string" ? input.base64.trim() : "";
  if (base64.length === 0) {
    throw new Error("Attachment base64 payload is required.");
  }

  const targetPath = await buildManagedAttachmentPath({
    attachmentId: input.attachmentId,
    extension: input.extension,
  });
  await writeFile(targetPath, Buffer.from(base64, "base64"));
  const fileInfo = await stat(targetPath);
  return {
    path: targetPath,
    byteSize: fileInfo.size,
  };
}

function normalizeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  throw new Error("Attachment byte payload is required.");
}

export async function writeAttachmentBytes(input: {
  attachmentId?: unknown;
  bytes?: unknown;
  extension?: unknown;
}): Promise<AttachmentFileResult> {
  const bytes = normalizeBytes(input.bytes);
  const targetPath = await buildManagedAttachmentPath({
    attachmentId: input.attachmentId,
    extension: input.extension,
  });
  await writeFile(targetPath, bytes);
  const fileInfo = await stat(targetPath);
  return {
    path: targetPath,
    byteSize: fileInfo.size,
  };
}

export async function copyAttachmentFileToManagedStorage(input: {
  attachmentId?: unknown;
  sourcePath?: unknown;
  extension?: unknown;
}): Promise<AttachmentFileResult> {
  if (typeof input.sourcePath !== "string" || input.sourcePath.trim().length === 0) {
    throw new Error("Attachment source path is required.");
  }

  const sourcePath = path.resolve(input.sourcePath.trim());
  const targetPath = await buildManagedAttachmentPath({
    attachmentId: input.attachmentId,
    extension: input.extension,
  });

  if (sourcePath !== targetPath) {
    await copyFile(sourcePath, targetPath);
  }

  const fileInfo = await stat(targetPath);
  return {
    path: targetPath,
    byteSize: fileInfo.size,
  };
}

export async function readManagedFileBase64(input: { path?: unknown }): Promise<string> {
  const filePath = resolveManagedAttachmentPath(input.path);
  const bytes = await readFile(filePath);
  return bytes.toString("base64");
}

export async function deleteManagedAttachmentFile(input: { path?: unknown }): Promise<boolean> {
  const filePath = resolveManagedAttachmentPath(input.path);
  await rm(filePath, { force: true });
  return true;
}

export async function garbageCollectManagedAttachmentFiles(
  input: {
    referencedIds?: unknown;
  },
  options: {
    minimumAgeMs?: number;
    nowMs?: number;
  } = {},
): Promise<number> {
  const dirPath = await ensureAttachmentsDir();
  const referencedIds = Array.isArray(input.referencedIds)
    ? new Set(
        input.referencedIds
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => ATTACHMENT_ID_PATTERN.test(value)),
      )
    : new Set<string>();

  const minimumAgeMs = Math.max(0, options.minimumAgeMs ?? 0);
  const nowMs = options.nowMs ?? Date.now();
  const entries = await readdir(dirPath, { withFileTypes: true });
  const candidates = entries.filter(
    (entry) => entry.isFile() && !referencedIds.has(path.parse(entry.name).name),
  );
  const deleteDecisions = await Promise.all(
    candidates.map(async (entry) => {
      if (minimumAgeMs === 0) {
        return true;
      }
      try {
        const fileInfo = await stat(path.join(dirPath, entry.name));
        const managedAtMs = Math.max(fileInfo.birthtimeMs, fileInfo.ctimeMs, fileInfo.mtimeMs);
        return nowMs - managedAtMs >= minimumAgeMs;
      } catch {
        return false;
      }
    }),
  );
  const toDelete = candidates.filter((_, index) => deleteDecisions[index]);

  await Promise.all(toDelete.map((entry) => rm(path.join(dirPath, entry.name), { force: true })));

  return toDelete.length;
}

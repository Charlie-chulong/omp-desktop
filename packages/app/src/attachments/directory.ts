import type { AgentAttachment } from "@omp-desktop/protocol/messages";
import type { DirectoryComposerAttachment, UserComposerAttachment } from "./types";

export function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (trimmed === "/" || /^[A-Za-z]:[\\/]*$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/[\\/]+$/, "");
}

export function getDirectoryName(path: string): string {
  const normalized = normalizeDirectoryPath(path);
  if (normalized === "/" || /^[A-Za-z]:[\\/]*$/.test(normalized)) {
    return normalized;
  }
  const name = normalized.split(/[\\/]/).pop();
  return name && name.length > 0 ? name : normalized;
}

export function createDirectoryComposerAttachment(path: string): DirectoryComposerAttachment {
  const normalizedPath = normalizeDirectoryPath(path);
  if (normalizedPath.length === 0) {
    throw new Error("Directory path cannot be empty.");
  }
  return { kind: "directory", path: normalizedPath };
}

export function getDirectoryAttachmentKey(attachment: DirectoryComposerAttachment): string {
  const path = normalizeDirectoryPath(attachment.path);
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
    ? path.replaceAll("\\", "/").toLowerCase()
    : path;
}

export function appendDirectoryAttachment(
  current: UserComposerAttachment[],
  attachment: DirectoryComposerAttachment,
): UserComposerAttachment[] {
  const key = getDirectoryAttachmentKey(attachment);
  const alreadyAttached = current.some(
    (candidate) => candidate.kind === "directory" && getDirectoryAttachmentKey(candidate) === key,
  );
  return alreadyAttached ? current : [...current, attachment];
}

export function directoryAttachmentToAgentAttachment(
  attachment: DirectoryComposerAttachment,
): Extract<AgentAttachment, { type: "text" }> {
  return {
    type: "text",
    mimeType: "text/plain",
    contextKind: "directory",
    title: getDirectoryName(attachment.path),
    text: `Directory: ${normalizeDirectoryPath(attachment.path)}`,
  };
}

export function getDirectoryAttachmentSubtitle(attachment: DirectoryComposerAttachment): string {
  return normalizeDirectoryPath(attachment.path);
}

export function isDirectoryComposerAttachment(
  value: unknown,
): value is DirectoryComposerAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === "directory" && typeof record.path === "string" && record.path.trim() !== ""
  );
}

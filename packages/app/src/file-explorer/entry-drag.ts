import { collapseExplorerDeletionPaths } from "@/file-explorer/selection";
import { parentExplorerPath } from "@/utils/explorer-paths";

export const EXPLORER_ENTRY_DRAG_MIME = "application/x-paseo-explorer-entry+json";

export interface ExplorerEntryDragItem {
  path: string;
  kind: "file" | "directory";
}

export interface ExplorerEntryDragPayload {
  version: 1;
  serverId: string;
  workspaceId: string;
  entries: ExplorerEntryDragItem[];
}

export interface ExplorerEntryMoveRequest {
  path: string;
  parentPath: string;
  kind: "file" | "directory";
}

export function serializeExplorerEntryDragPayload(payload: ExplorerEntryDragPayload): string {
  return JSON.stringify(payload);
}

function parseExplorerEntryDragItem(value: unknown): ExplorerEntryDragItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.path !== "string" ||
    record.path.length === 0 ||
    (record.kind !== "file" && record.kind !== "directory")
  ) {
    return null;
  }
  return { path: record.path, kind: record.kind };
}

export function parseExplorerEntryDragPayload(serialized: string): ExplorerEntryDragPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.serverId !== "string" ||
    record.serverId.length === 0 ||
    typeof record.workspaceId !== "string" ||
    record.workspaceId.length === 0 ||
    !Array.isArray(record.entries) ||
    record.entries.length === 0
  ) {
    return null;
  }
  const entries: ExplorerEntryDragItem[] = [];
  for (const item of record.entries) {
    const parsed = parseExplorerEntryDragItem(item);
    if (!parsed) {
      return null;
    }
    entries.push(parsed);
  }
  return {
    version: 1,
    serverId: record.serverId,
    workspaceId: record.workspaceId,
    entries,
  };
}

export function resolveExplorerDragEntries(input: {
  dragged: ExplorerEntryDragItem;
  selectedEntries: readonly ExplorerEntryDragItem[];
}): ExplorerEntryDragItem[] {
  const { dragged, selectedEntries } = input;
  if (!selectedEntries.some((entry) => entry.path === dragged.path)) {
    return [dragged];
  }
  const entries: ExplorerEntryDragItem[] = [];
  const seen = new Set<string>();
  for (const entry of [dragged, ...selectedEntries]) {
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);
    entries.push(entry);
  }
  return entries;
}

function canMoveExplorerEntry(entry: ExplorerEntryDragItem, parentPath: string): boolean {
  if (entry.path === "." || parentExplorerPath(entry.path) === parentPath) {
    return false;
  }
  if (
    entry.kind === "directory" &&
    (parentPath === entry.path || parentPath.startsWith(`${entry.path}/`))
  ) {
    return false;
  }
  return true;
}

export function resolveExplorerEntryMoves(input: {
  payload: ExplorerEntryDragPayload;
  serverId: string;
  workspaceId: string;
  parentPath: string;
}): ExplorerEntryMoveRequest[] | null {
  const { payload, serverId, workspaceId, parentPath } = input;
  if (payload.serverId !== serverId || payload.workspaceId !== workspaceId) {
    return null;
  }
  const kindByPath = new Map(payload.entries.map((entry) => [entry.path, entry.kind]));
  const requests: ExplorerEntryMoveRequest[] = [];
  for (const path of collapseExplorerDeletionPaths(payload.entries.map((entry) => entry.path))) {
    const kind = kindByPath.get(path);
    if (!kind) {
      continue;
    }
    const entry = { path, kind };
    if (!canMoveExplorerEntry(entry, parentPath)) {
      continue;
    }
    requests.push({ path, parentPath, kind });
  }
  return requests.length > 0 ? requests : null;
}

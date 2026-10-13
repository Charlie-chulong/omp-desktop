import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";

export interface ActiveProjectSelection {
  serverId: string;
  projectId: string;
}

export const PROJECT_SELECTION_STORAGE_KEY = "omp-desktop:last-project-workspaces";

export interface ProjectSelectionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export function projectSelectionKey(selection: ActiveProjectSelection): string {
  return `${selection.serverId}:project:${encodeURIComponent(selection.projectId)}`;
}

function parseSelections(value: string | null): Record<string, ActiveWorkspaceSelection> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, ActiveWorkspaceSelection> = {};
    for (const [key, selection] of Object.entries(parsed)) {
      if (!selection || typeof selection !== "object") continue;
      const candidate = selection as Record<string, unknown>;
      if (
        typeof candidate.serverId === "string" &&
        candidate.serverId.trim() &&
        typeof candidate.workspaceId === "string" &&
        candidate.workspaceId.trim() &&
        key.startsWith(`${candidate.serverId}:project:`)
      ) {
        result[key] = { serverId: candidate.serverId, workspaceId: candidate.workspaceId };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function createProjectSelectionStore(storage: ProjectSelectionStorage) {
  let selections: Record<string, ActiveWorkspaceSelection> = {};
  let revision = 0;
  let hydration: Promise<void> | null = null;
  let pendingWrite: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: (project: ActiveProjectSelection) => selections[projectSelectionKey(project)] ?? null,
    remember(project: ActiveProjectSelection, workspace: ActiveWorkspaceSelection) {
      if (
        project.serverId !== workspace.serverId ||
        !project.projectId.trim() ||
        !workspace.workspaceId.trim()
      )
        return;
      const key = projectSelectionKey(project);
      if (selections[key]?.workspaceId === workspace.workspaceId) return;
      selections = { ...selections, [key]: workspace };
      revision += 1;
      notify();
      const snapshot = JSON.stringify(selections);
      pendingWrite = pendingWrite.catch(() => {}).then(() => storage.write(snapshot));
    },
    hydrate() {
      if (hydration) return hydration;
      const startingRevision = revision;
      hydration = storage
        .read()
        .then((value) => {
          selections = { ...parseSelections(value), ...selections };
          notify();
          if (revision !== startingRevision) {
            const snapshot = JSON.stringify(selections);
            pendingWrite = pendingWrite.catch(() => {}).then(() => storage.write(snapshot));
          }
        })
        .catch(() => {});
      return hydration;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

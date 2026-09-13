export interface ExplorerSelectionRequest {
  path: string;
  visiblePaths: readonly string[];
  selectedPaths: ReadonlySet<string>;
  anchorPath: string | null;
  additive: boolean;
  range: boolean;
}

export interface ExplorerSelectionResult {
  selectedPaths: Set<string>;
  anchorPath: string;
  activePath: string | null;
}

export function resolveExplorerSelection({
  path,
  visiblePaths,
  selectedPaths,
  anchorPath,
  additive,
  range,
}: ExplorerSelectionRequest): ExplorerSelectionResult {
  if (range) {
    const anchorIndex = anchorPath ? visiblePaths.indexOf(anchorPath) : -1;
    const targetIndex = visiblePaths.indexOf(path);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const next = additive ? new Set(selectedPaths) : new Set<string>();
      for (let index = start; index <= end; index += 1) {
        const visiblePath = visiblePaths[index];
        if (visiblePath !== undefined) next.add(visiblePath);
      }
      return { selectedPaths: next, anchorPath: anchorPath ?? path, activePath: path };
    }
  }

  if (additive) {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return {
      selectedPaths: next,
      anchorPath: path,
      activePath: next.has(path) ? path : firstVisibleSelectedPath(visiblePaths, next),
    };
  }

  return {
    selectedPaths: new Set([path]),
    anchorPath: path,
    activePath: path,
  };
}

export function collapseExplorerDeletionPaths(paths: Iterable<string>): string[] {
  const uniquePaths = [...new Set(paths)];
  return uniquePaths.filter(
    (path) =>
      !uniquePaths.some((otherPath) => otherPath !== path && path.startsWith(`${otherPath}/`)),
  );
}

interface ExplorerDeleteResult {
  success: boolean;
  error?: string | null;
}

export async function deleteExplorerSelectionPaths(
  paths: Iterable<string>,
  deletePath: (path: string) => Promise<ExplorerDeleteResult | null>,
): Promise<{ deletedPaths: string[]; failed: boolean; firstError: string | null }> {
  const deletedPaths: string[] = [];
  let failed = false;
  let firstError: string | null = null;
  for (const path of collapseExplorerDeletionPaths(paths)) {
    try {
      const result = await deletePath(path);
      if (result?.success) {
        deletedPaths.push(path);
      } else {
        failed = true;
        firstError ??= result?.error ?? null;
      }
    } catch (cause) {
      failed = true;
      firstError ??= cause instanceof Error ? cause.message : String(cause);
    }
  }
  return { deletedPaths, failed, firstError };
}

function firstVisibleSelectedPath(
  visiblePaths: readonly string[],
  selectedPaths: ReadonlySet<string>,
): string | null {
  for (const path of visiblePaths) {
    if (selectedPaths.has(path)) return path;
  }
  return null;
}

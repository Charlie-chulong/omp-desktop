import type { ExplorerEntryMoveRequest } from "./entry-drag";

interface ExplorerMoveResult {
  success: boolean;
  movedPath?: string | null;
  error?: string | null;
}

/** Shared by drag/drop and explicit move: reconcile only confirmed successful operations. */
export async function moveExplorerSelection(
  requests: readonly ExplorerEntryMoveRequest[],
  moveEntry: (input: { path: string; parentPath: string }) => Promise<ExplorerMoveResult | null>,
  reconcile: (entry: ExplorerEntryMoveRequest, movedPath: string) => Promise<void>,
): Promise<{ movedPaths: string[]; failed: boolean; firstError: string | null }> {
  const movedPaths: string[] = [];
  let failed = false;
  let firstError: string | null = null;
  for (const request of requests) {
    try {
      const result = await moveEntry({ path: request.path, parentPath: request.parentPath });
      if (!result?.success || !result.movedPath) {
        failed = true;
        firstError ??= result?.error ?? null;
        continue;
      }
      movedPaths.push(request.path);
      await reconcile(request, result.movedPath);
    } catch (cause) {
      failed = true;
      firstError ??= cause instanceof Error ? cause.message : String(cause);
    }
  }
  return { movedPaths, failed, firstError };
}

import type { DroppedItem } from "@/components/file-drop/types";

export function droppedDirectoryPaths(items: readonly DroppedItem[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.kind !== "directory-path" || seen.has(item.path)) continue;
    seen.add(item.path);
    paths.push(item.path);
  }
  return paths;
}

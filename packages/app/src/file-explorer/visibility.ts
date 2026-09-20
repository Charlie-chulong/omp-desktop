import type { ExplorerEntry } from "@/stores/session-store";

export function isHiddenExplorerPath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment !== "." && segment !== ".." && segment.startsWith("."));
}

function isAlwaysHiddenExplorerName(name: string): boolean {
  return name === ".DS_Store";
}

export function filterVisibleExplorerEntries(
  entries: ExplorerEntry[],
  showHiddenFiles: boolean,
): ExplorerEntry[] {
  return entries.filter((entry) => {
    if (isAlwaysHiddenExplorerName(entry.name)) {
      return false;
    }
    return showHiddenFiles || !entry.name.startsWith(".");
  });
}

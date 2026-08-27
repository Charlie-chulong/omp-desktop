import type { DroppedItem } from "./types";

interface DroppedFileSystemEntry {
  isDirectory: boolean;
}

interface DroppedDataTransferItem {
  webkitGetAsEntry?: () => DroppedFileSystemEntry | null;
}

interface CreateDroppedItemsInput {
  files: File[];
  transferItems: readonly DroppedDataTransferItem[];
  getPathForFile?: (file: File) => string;
}

export function createDroppedItems({
  files,
  transferItems,
  getPathForFile,
}: CreateDroppedItemsInput): DroppedItem[] {
  return files.map((file, index) => {
    const transferItem = transferItems[index];
    const entry = transferItem?.webkitGetAsEntry?.();
    if (entry?.isDirectory === true && getPathForFile) {
      const path = getPathForFile(file);
      if (path.length > 0) {
        return { kind: "directory-path" as const, path };
      }
    }
    return { kind: "web-file" as const, file };
  });
}

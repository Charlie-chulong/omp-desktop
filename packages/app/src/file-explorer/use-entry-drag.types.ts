import type { RefCallback } from "react";
import type { View } from "react-native";
import type { WorkspaceFileDragPayload } from "@/attachments/workspace-file-drag";
import type {
  ExplorerEntryDragPayload,
  ExplorerEntryMoveRequest,
} from "@/file-explorer/entry-drag";

export interface ExplorerEntryDragSource {
  payload: ExplorerEntryDragPayload;
  chatAttachment?: WorkspaceFileDragPayload["attachment"];
  moveEnabled: boolean;
}

export interface ExplorerEntryDropTarget {
  serverId: string;
  workspaceId: string;
  parentPath: string;
  blockedDescendantSelector?: string;
  onMove(requests: ExplorerEntryMoveRequest[]): void;
}

export interface UseExplorerEntryDragInput {
  source?: ExplorerEntryDragSource;
  target?: ExplorerEntryDropTarget;
}

export interface ExplorerEntryDragBinding {
  ref: RefCallback<View> | undefined;
  isDropTarget: boolean;
}

import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";
import type { View } from "react-native";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import {
  WORKSPACE_FILE_POINTER_DRAG_EVENT,
  type WorkspaceFileDragPayload,
  type WorkspaceFilePointerDragDetail,
} from "@/attachments/workspace-file-drag";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { resolveExplorerEntryMoves, type ExplorerEntryDragPayload } from "./entry-drag";
import type {
  ExplorerEntryDragBinding,
  ExplorerEntryDropTarget,
  UseExplorerEntryDragInput,
} from "./use-entry-drag.types";

interface PointerDropTarget {
  target: ExplorerEntryDropTarget;
  setHovered(hovered: boolean): void;
}

interface ExplorerDragPreview {
  element: HTMLElement;
  width: number;
  height: number;
}

const dropTargets = new Map<HTMLElement, PointerDropTarget>();
let cancelActiveDrag: (() => void) | null = null;

function findDropTarget(hit: Element | null) {
  for (let element = hit; element; element = element.parentElement) {
    const binding = dropTargets.get(element as HTMLElement);
    if (binding) {
      const blocked = binding.target.blockedDescendantSelector;
      return blocked && hit?.closest(blocked) ? null : binding;
    }
  }
  return null;
}

function resolveMoves(payload: ExplorerEntryDragPayload, binding: PointerDropTarget | null) {
  return binding
    ? resolveExplorerEntryMoves({
        payload,
        serverId: binding.target.serverId,
        workspaceId: binding.target.workspaceId,
        parentPath: binding.target.parentPath,
      })
    : null;
}

function createDragPreview(source: HTMLElement, count: number, view: Window): ExplorerDragPreview {
  const document = source.ownerDocument;
  let background = "Canvas";
  for (let ancestor: HTMLElement | null = source; ancestor; ancestor = ancestor.parentElement) {
    const color = view.getComputedStyle(ancestor).backgroundColor;
    if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
      background = color;
      break;
    }
  }

  const preview = document.createElement("div");
  preview.dataset.testid = "file-explorer-drag-preview";
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;
  Object.assign(preview.style, {
    position: "fixed",
    left: "0",
    top: "0",
    display: "flex",
    alignItems: "center",
    maxWidth: "calc(100vw - 16px)",
    pointerEvents: "none",
    opacity: "0.8",
    backgroundColor: background,
    border: "1px solid rgba(127, 127, 127, 0.35)",
    borderRadius: "6px",
    boxShadow: "0 6px 18px rgba(0, 0, 0, 0.2)",
    zIndex: String(OVERLAY_Z.tooltip),
  });

  const row = source.cloneNode(true) as HTMLElement;
  for (const node of [row, ...row.querySelectorAll<HTMLElement | SVGElement>("*")]) {
    node.removeAttribute("id");
    node.removeAttribute("data-testid");
    node.style.pointerEvents = "none";
  }
  Object.assign(row.style, {
    flex: "0 1 auto",
    width: "max-content",
    maxWidth: "280px",
    minWidth: "0",
    padding: "6px 10px",
    margin: "0",
    backgroundColor: "transparent",
  });
  preview.appendChild(row);

  if (count > 1) {
    const badge = document.createElement("span");
    badge.textContent = String(count);
    Object.assign(badge.style, {
      flexShrink: "0",
      marginRight: "8px",
      padding: "0 6px",
      borderRadius: "9px",
      backgroundColor: "rgba(127, 127, 127, 0.25)",
      color: "CanvasText",
      font: "600 12px/18px sans-serif",
    });
    preview.appendChild(badge);
  }

  getOverlayRoot().appendChild(preview);
  const { width, height } = preview.getBoundingClientRect();
  return { element: preview, width, height };
}

// mini-electron does not complete HTML drag sources. Pointer dragging handles tree
// moves and delivers file references through the composer's existing drop zone.
export function useExplorerEntryDrag({
  source,
  target,
}: UseExplorerEntryDragInput): ExplorerEntryDragBinding {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const ref = useCallback<RefCallback<View>>((node) => {
    setElement(node as unknown as HTMLElement | null);
  }, []);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    if (!element || !target) return;
    const binding = { target, setHovered: setIsDropTarget };
    dropTargets.set(element, binding);
    return () => {
      if (dropTargets.get(element) === binding) dropTargets.delete(element);
      binding.setHovered(false);
    };
  }, [element, target]);

  // Focus and selection updates can replace source/target objects during a drag.
  // Keep the gesture listeners mounted until the row itself unmounts.
  useEffect(() => {
    if (!element) return;
    const dragElement = element;
    const document = dragElement.ownerDocument;
    const ownerWindow = document.defaultView;
    if (!ownerWindow) return;
    const view = ownerWindow;

    let cancelGesture: (() => void) | null = null;
    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      const source = sourceRef.current;
      if (!source || (!source.moveEnabled && !source.includeChatAttachment)) return;
      cancelActiveDrag?.();
      const { payload, moveEnabled, includeChatAttachment } = source;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let cancelled = false;
      let hovered: PointerDropTarget | null = null;
      let preview: ExplorerDragPreview | null = null;
      let workspaceFilePayload: WorkspaceFileDragPayload | null = null;
      let chatTarget: HTMLElement | null = null;

      function dispatchChatDrag(
        element: HTMLElement,
        phase: WorkspaceFilePointerDragDetail["phase"],
      ) {
        if (!workspaceFilePayload) return;
        element.dispatchEvent(
          new CustomEvent<WorkspaceFilePointerDragDetail>(WORKSPACE_FILE_POINTER_DRAG_EVENT, {
            detail: { phase, payload: workspaceFilePayload },
          }),
        );
      }

      function clearChatTarget() {
        if (chatTarget) dispatchChatDrag(chatTarget, "leave");
        chatTarget = null;
      }

      function updateTarget(x: number, y: number) {
        const hit = document.elementFromPoint(x, y);
        const nextChatTarget = workspaceFilePayload
          ? (hit?.closest<HTMLElement>('[data-file-drop-owner="attachment"]') ?? null)
          : null;
        if (nextChatTarget !== chatTarget) {
          clearChatTarget();
          chatTarget = nextChatTarget;
        }
        if (chatTarget) dispatchChatDrag(chatTarget, "over");
        const candidate = moveEnabled && !chatTarget ? findDropTarget(hit) : null;
        const next = resolveMoves(payload, candidate) ? candidate : null;
        if (next !== hovered) {
          hovered?.setHovered(false);
          hovered = next;
          hovered?.setHovered(true);
        }
      }

      function finish() {
        preview?.element.remove();
        preview = null;
        clearChatTarget();
        hovered?.setHovered(false);
        document.removeEventListener("pointermove", handlePointerMove, true);
        document.removeEventListener("pointerup", handlePointerUp, true);
        document.removeEventListener("pointercancel", handlePointerCancel, true);
        document.removeEventListener("keydown", handleKeyDown, true);
        dragElement.removeEventListener("lostpointercapture", handlePointerCancel);
        view.removeEventListener("blur", finish);
        if (dragElement.hasPointerCapture(pointerId)) dragElement.releasePointerCapture(pointerId);
        if (dragging) {
          // A completed or cancelled drag must not open a file/toggle a folder.
          view.setTimeout(() => document.removeEventListener("click", preventClick, true), 0);
        }
        cancelGesture = null;
        if (cancelActiveDrag === finish) cancelActiveDrag = null;
      }

      function preventClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
      }

      function handlePointerMove(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        if ((event.buttons & 1) === 0) {
          finish();
          return;
        }
        if (cancelled) return;
        if (!dragging) {
          if (Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return;
          dragging = true;
          if (includeChatAttachment) {
            const entry = payload.entries.find((entry) => entry.kind === "file");
            if (entry) {
              workspaceFilePayload = {
                version: 1,
                serverId: payload.serverId,
                workspaceId: payload.workspaceId,
                attachment: createWorkspaceFileAttachment({ path: entry.path }),
              };
            }
          }
          preview = createDragPreview(dragElement, payload.entries.length, view);
          dragElement.setPointerCapture(pointerId);
          document.addEventListener("click", preventClick, true);
        }
        event.preventDefault();
        if (preview) {
          const x = Math.max(8, Math.min(event.clientX + 12, view.innerWidth - preview.width - 8));
          const y = Math.max(
            8,
            Math.min(event.clientY + 12, view.innerHeight - preview.height - 8),
          );
          preview.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
        updateTarget(event.clientX, event.clientY);
      }

      function handlePointerUp(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        const hit =
          dragging && !cancelled ? document.elementFromPoint(event.clientX, event.clientY) : null;
        const chatDestination = workspaceFilePayload
          ? (hit?.closest<HTMLElement>('[data-file-drop-owner="attachment"]') ?? null)
          : null;
        const destination = moveEnabled && !chatDestination ? findDropTarget(hit) : null;
        const requests = resolveMoves(payload, destination);
        finish();
        if (chatDestination) {
          dispatchChatDrag(chatDestination, "drop");
        } else if (requests && destination) {
          destination.target.onMove(requests);
        }
      }

      function handlePointerCancel(event: PointerEvent) {
        if (event.pointerId === pointerId) finish();
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancelled = true;
        preview?.element.remove();
        preview = null;
        clearChatTarget();
        hovered?.setHovered(false);
        hovered = null;
      }

      cancelGesture = finish;
      cancelActiveDrag = finish;
      document.addEventListener("pointermove", handlePointerMove, true);
      document.addEventListener("pointerup", handlePointerUp, true);
      document.addEventListener("pointercancel", handlePointerCancel, true);
      document.addEventListener("keydown", handleKeyDown, true);
      dragElement.addEventListener("lostpointercapture", handlePointerCancel);
      view.addEventListener("blur", finish);
    }

    function preventNativeDrag(event: DragEvent) {
      const source = sourceRef.current;
      if (source && (source.moveEnabled || source.includeChatAttachment)) event.preventDefault();
    }

    dragElement.addEventListener("pointerdown", handlePointerDown);
    dragElement.addEventListener("dragstart", preventNativeDrag);
    return () => {
      cancelGesture?.();
      dragElement.removeEventListener("pointerdown", handlePointerDown);
      dragElement.removeEventListener("dragstart", preventNativeDrag);
    };
  }, [element]);

  return { ref, isDropTarget };
}

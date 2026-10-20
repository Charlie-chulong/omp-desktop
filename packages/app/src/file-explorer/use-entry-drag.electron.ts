import { useCallback, useEffect, useState, type RefCallback } from "react";
import type { View } from "react-native";
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

const dropTargets = new Map<HTMLElement, PointerDropTarget>();
let cancelActiveDrag: (() => void) | null = null;

function findDropTarget(document: Document, x: number, y: number) {
  const hit = document.elementFromPoint(x, y);
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

// mini-electron does not complete HTML drag sources. Internal moves use pointer
// capture instead, without changing the browser's HTML file/chat drag protocol.
export function useExplorerEntryDrag({
  source,
  target,
}: UseExplorerEntryDragInput): ExplorerEntryDragBinding {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const ref = useCallback<RefCallback<View>>((node) => {
    setElement(node as unknown as HTMLElement | null);
  }, []);

  useEffect(() => {
    if (!element) return;
    const dragElement = element;
    const document = dragElement.ownerDocument;
    const ownerWindow = document.defaultView;
    if (!ownerWindow) return;
    const view = ownerWindow;
    const binding = target ? { target, setHovered: setIsDropTarget } : null;
    if (binding) dropTargets.set(dragElement, binding);

    let cancelGesture: (() => void) | null = null;
    function handlePointerDown(event: PointerEvent) {
      if (!source?.moveEnabled || event.button !== 0 || event.pointerType !== "mouse") return;
      cancelActiveDrag?.();
      const payload = source.payload;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let cancelled = false;
      let hovered: PointerDropTarget | null = null;

      function updateTarget(x: number, y: number) {
        const candidate = findDropTarget(document, x, y);
        const next = resolveMoves(payload, candidate) ? candidate : null;
        if (next !== hovered) {
          hovered?.setHovered(false);
          hovered = next;
          hovered?.setHovered(true);
        }
      }

      function finish() {
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
          dragElement.setPointerCapture(pointerId);
          document.addEventListener("click", preventClick, true);
        }
        event.preventDefault();
        updateTarget(event.clientX, event.clientY);
      }

      function handlePointerUp(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        const destination =
          dragging && !cancelled ? findDropTarget(document, event.clientX, event.clientY) : null;
        const requests = resolveMoves(payload, destination);
        finish();
        if (requests && destination) destination.target.onMove(requests);
      }

      function handlePointerCancel(event: PointerEvent) {
        if (event.pointerId === pointerId) finish();
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancelled = true;
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
      if (source?.moveEnabled) event.preventDefault();
    }

    dragElement.addEventListener("pointerdown", handlePointerDown);
    dragElement.addEventListener("dragstart", preventNativeDrag);
    return () => {
      cancelGesture?.();
      dragElement.removeEventListener("pointerdown", handlePointerDown);
      dragElement.removeEventListener("dragstart", preventNativeDrag);
      if (dropTargets.get(dragElement) === binding) dropTargets.delete(dragElement);
      binding?.setHovered(false);
    };
  }, [element, source, target]);

  return { ref, isDropTarget };
}

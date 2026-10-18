import { useCallback, useReducer } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";
import { reorderItemsOnDragEnd } from "./reorder-items";

export interface DragReorderHandlers {
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

export interface DragReorderState<T> {
  activeId: string | null;
  items: T[];
  handlers: DragReorderHandlers;
}

export function useDragReorderState<T>({
  data,
  keyExtractor,
  onDragEnd,
  onReorder,
  onDragBegin,
  disabled = false,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onDragEnd?: (items: T[]) => void;
  onReorder?: (activeId: string, overId: string) => void;
  onDragBegin?: () => void;
  disabled?: boolean;
}): DragReorderState<T> {
  const [state, dispatch] = useReducer(dragStateReducer<T>, undefined, dragStateInitial<T>);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (disabled) return;
      dispatch({ type: "start", id: String(event.active.id), data });
      onDragBegin?.();
    },
    [data, disabled, onDragBegin],
  );

  const clearDragState = useCallback(() => {
    dispatch({ type: "clear" });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const items = onReorder ? data : (state.dragItems ?? data);
      dispatch({ type: "clear" });
      if (disabled) return;
      if (onReorder) {
        const activeId = String(active.id);
        const overId = over ? String(over.id) : null;
        if (
          overId &&
          activeId !== overId &&
          data.some((item, index) => keyExtractor(item, index) === activeId) &&
          data.some((item, index) => keyExtractor(item, index) === overId)
        ) {
          onReorder(activeId, overId);
        }
        return;
      }

      const reordered = reorderItemsOnDragEnd({
        items,
        activeId: String(active.id),
        overId: over ? String(over.id) : null,
        keyExtractor,
      });
      if (reordered) onDragEnd?.(reordered);
    },
    [data, disabled, keyExtractor, onDragEnd, onReorder, state.dragItems],
  );

  return {
    activeId: state.activeId,
    items: onReorder ? data : (state.dragItems ?? data),
    handlers: {
      onDragStart: handleDragStart,
      onDragCancel: clearDragState,
      onDragEnd: handleDragEnd,
    },
  };
}

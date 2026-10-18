/** @vitest-environment jsdom */
import { act, renderHook, cleanup } from "@testing-library/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDragReorderState } from "./use-drag-reorder-state";

interface Item {
  id: string;
}
const keyExtractor = (item: Item) => item.id;
const initial: Item[] = [{ id: "A" }, { id: "B" }, { id: "C" }];
const start = { active: { id: "C" } } as DragStartEvent;
const end = { active: { id: "C" }, over: { id: "B" } } as DragEndEvent;

afterEach(cleanup);

describe("ID-based drag reordering", () => {
  it("renders live additions/removals during drag and commits only the dragged IDs", () => {
    const onReorder = vi.fn();
    const onDragEnd = vi.fn();
    const { result, rerender } = renderHook(
      ({ data }) => useDragReorderState({ data, keyExtractor, onReorder, onDragEnd }),
      { initialProps: { data: initial } },
    );
    act(() => result.current.handlers.onDragStart(start));
    expect(result.current.activeId).toBe("C");

    const latest = [initial[1]!, initial[2]!, { id: "D" }];
    rerender({ data: latest });
    expect(result.current.items).toBe(latest);

    act(() => result.current.handlers.onDragEnd(end));
    expect(onReorder).toHaveBeenCalledExactlyOnceWith("C", "B");
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(result.current.activeId).toBeNull();
    expect(result.current.items).toBe(latest);
  });

  it.each(["B", "C"])("ignores the drop if endpoint %s is no longer pending", (removedId) => {
    const onReorder = vi.fn();
    const { result, rerender } = renderHook(
      ({ data }) => useDragReorderState({ data, keyExtractor, onReorder }),
      { initialProps: { data: initial } },
    );
    act(() => result.current.handlers.onDragStart(start));
    const latest = initial.filter((item) => item.id !== removedId);
    rerender({ data: latest });

    act(() => result.current.handlers.onDragEnd(end));
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.items).toBe(latest);
    expect(result.current.activeId).toBeNull();
  });

  it("cancels without a commit and keeps the current authoritative order", () => {
    const onReorder = vi.fn();
    const { result, rerender } = renderHook(
      ({ data }) => useDragReorderState({ data, keyExtractor, onReorder }),
      { initialProps: { data: initial } },
    );
    act(() => result.current.handlers.onDragStart(start));
    const latest = [initial[1]!, initial[2]!];
    rerender({ data: latest });

    act(() => result.current.handlers.onDragCancel());
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.activeId).toBeNull();
    expect(result.current.items).toBe(latest);
  });
});

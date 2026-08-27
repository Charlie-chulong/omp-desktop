import { describe, expect, it } from "vitest";
import { getQuotedSelectionText } from "./quoted-selection";

function selection(text: string, anchorNode: Node, focusNode: Node) {
  return {
    anchorNode,
    focusNode,
    toString: () => text,
  } as Pick<Selection, "anchorNode" | "focusNode" | "toString">;
}

describe("quoted selection context menu", () => {
  it("returns a trimmed selection fully contained in the transcript", () => {
    const anchor = {} as Node;
    const focus = {} as Node;
    const container = { contains: (node: Node | null) => node === anchor || node === focus };

    expect(
      getQuotedSelectionText(container, selection("  selected context\n", anchor, focus)),
    ).toBe("selected context");
  });

  it("rejects empty and cross-surface selections", () => {
    const inside = {} as Node;
    const outside = {} as Node;
    const container = { contains: (node: Node | null) => node === inside };

    expect(getQuotedSelectionText(container, selection("   ", inside, inside))).toBeNull();
    expect(getQuotedSelectionText(container, selection("context", inside, outside))).toBeNull();
    expect(getQuotedSelectionText(container, null)).toBeNull();
  });
});

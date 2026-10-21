import { describe, expect, it } from "vitest";
import { getQuotedSelectionText, isSameQuotedSelectionRange } from "./quoted-selection";

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

  it("leaves editable and CodeMirror selections to the editor", () => {
    const editorElement = {
      nodeType: 1,
      closest: (selector: string) => (selector.includes(".cm-editor") ? editorElement : null),
    } as unknown as Element;
    const editorText = { parentElement: editorElement } as unknown as Node;
    const transcriptText = {} as Node;
    const container = { contains: () => true };

    expect(
      getQuotedSelectionText(container, selection("draft", editorText, editorText)),
    ).toBeNull();
    expect(
      getQuotedSelectionText(
        container,
        selection("old transcript selection", transcriptText, transcriptText),
        editorElement,
      ),
    ).toBeNull();
  });

  it("requires the exact current range, not merely matching selected text", () => {
    const first = {} as Node;
    const second = {} as Node;
    const range = {
      startContainer: first,
      startOffset: 1,
      endContainer: first,
      endOffset: 5,
    } as Range;

    expect(isSameQuotedSelectionRange(range, { ...range } as Range)).toBe(true);
    expect(isSameQuotedSelectionRange(range, { ...range, startOffset: 2 } as Range)).toBe(false);
    expect(isSameQuotedSelectionRange(range, { ...range, endContainer: second } as Range)).toBe(
      false,
    );
    expect(isSameQuotedSelectionRange(range, null)).toBe(false);
    expect(isSameQuotedSelectionRange(null, range)).toBe(false);
  });
});

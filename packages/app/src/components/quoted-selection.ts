export interface SelectionContainer {
  contains(node: Node | null): boolean;
}

const EDITABLE_SELECTION_SELECTOR =
  'input, textarea, [contenteditable]:not([contenteditable="false"]), .cm-editor';

function isEditableSelectionNode(node: Node | null): boolean {
  const element = node?.nodeType === 1 ? (node as Element) : node?.parentElement;
  return Boolean(element?.closest(EDITABLE_SELECTION_SELECTOR));
}

export function getQuotedSelectionText(
  container: SelectionContainer,
  selection: Pick<Selection, "anchorNode" | "focusNode" | "toString"> | null,
  activeElement?: Element | null,
): string | null {
  if (!selection) return null;
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) {
    return null;
  }
  // Editor selections belong to their native editing/copy commands, never the transcript toolbar.
  if (
    activeElement?.closest(EDITABLE_SELECTION_SELECTOR) ||
    isEditableSelectionNode(selection.anchorNode) ||
    isEditableSelectionNode(selection.focusNode)
  ) {
    return null;
  }
  const text = selection.toString().trim();
  return text || null;
}

export function isSameQuotedSelectionRange(previous: Range | null, current: Range | null): boolean {
  return Boolean(
    previous &&
    current &&
    previous.startContainer === current.startContainer &&
    previous.startOffset === current.startOffset &&
    previous.endContainer === current.endContainer &&
    previous.endOffset === current.endOffset,
  );
}

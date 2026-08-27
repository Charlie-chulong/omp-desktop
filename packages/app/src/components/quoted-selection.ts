export interface SelectionContainer {
  contains(node: Node | null): boolean;
}

export function getQuotedSelectionText(
  container: SelectionContainer,
  selection: Pick<Selection, "anchorNode" | "focusNode" | "toString"> | null,
): string | null {
  if (!selection) return null;
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) {
    return null;
  }
  const text = selection.toString().trim();
  return text || null;
}

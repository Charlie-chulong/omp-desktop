import { getDesktopHost } from "@/desktop/host";

export function attachComposerContextMenu(input: HTMLTextAreaElement): () => void {
  const handleContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || event.target !== input) return;
    const showContextMenu = getDesktopHost()?.menu?.showContextMenu;
    if (!showContextMenu) return;

    event.preventDefault();
    event.stopPropagation();
    // Native edit roles operate on the focused editor, including its existing selection.
    input.focus({ preventScroll: true });
    void showContextMenu({
      kind: "composer-input",
      hasSelection: input.selectionStart !== input.selectionEnd,
      isEditable: !input.readOnly && !input.disabled,
    }).catch((error: unknown) => {
      console.error("[MessageInput] Failed to open native context menu:", error);
    });
  };

  input.addEventListener("contextmenu", handleContextMenu);
  return () => input.removeEventListener("contextmenu", handleContextMenu);
}

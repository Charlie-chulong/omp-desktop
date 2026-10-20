import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { attachComposerContextMenu } from "./context-menu";

const cleanups: Array<() => void> = [];

function mountInput(): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  document.body.appendChild(input);
  const detach = attachComposerContextMenu(input);
  cleanups.push(() => {
    detach();
    input.remove();
  });
  return input;
}

function installDesktopMenu() {
  const showContextMenu = vi.fn(async () => null);
  window.paseoDesktop = { menu: { showContextMenu } };
  return showContextMenu;
}

function contextMenu(button = 2): MouseEvent {
  return new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button });
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  delete window.paseoDesktop;
});

describe("composer native context menu", () => {
  it("opens native editing actions at the actual input without losing its selection", () => {
    const showContextMenu = installDesktopMenu();
    const input = mountInput();
    input.value = "selected text";
    input.setSelectionRange(0, 8);
    const event = contextMenu();

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(8);
    expect(input.value).toBe("selected text");
    expect(showContextMenu).toHaveBeenCalledExactlyOnceWith({
      kind: "composer-input",
      hasSelection: true,
      isEditable: true,
    });
  });

  it("preserves the selected editor across async menu IPC and leaves text editing usable", async () => {
    const pendingMenu = Promise.withResolvers<null>();
    const showContextMenu = vi.fn(() => pendingMenu.promise);
    window.paseoDesktop = { menu: { showContextMenu } };
    const input = mountInput();
    input.value = "selected text";
    input.setSelectionRange(0, 8);

    input.dispatchEvent(contextMenu());
    await Promise.resolve();

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("selected text");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(8);
    pendingMenu.resolve(null);
    await pendingMenu.promise;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("selected text");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(8);

    await userEvent.keyboard("replacement");
    expect(input.value).toBe("replacement text");
  });

  it("accepts keyboard-origin context menus without requiring a right mouse button", () => {
    const showContextMenu = installDesktopMenu();
    const input = mountInput();
    const event = contextMenu(0);

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(showContextMenu).toHaveBeenCalledExactlyOnceWith({
      kind: "composer-input",
      hasSelection: false,
      isEditable: true,
    });
  });

  it("keeps copy available while reporting a locked editor as non-editable", () => {
    const showContextMenu = installDesktopMenu();
    const input = mountInput();
    input.value = "locked text";
    input.readOnly = true;
    input.setSelectionRange(0, input.value.length);

    input.dispatchEvent(contextMenu());

    expect(showContextMenu).toHaveBeenCalledExactlyOnceWith({
      kind: "composer-input",
      hasSelection: true,
      isEditable: false,
    });
  });

  it("leaves browser native menus and non-composer image targets alone", () => {
    const input = mountInput();
    const browserEvent = contextMenu();
    input.dispatchEvent(browserEvent);
    expect(browserEvent.defaultPrevented).toBe(false);

    const showContextMenu = installDesktopMenu();
    const thumbnail = document.createElement("img");
    document.body.appendChild(thumbnail);
    cleanups.push(() => thumbnail.remove());
    const imageEvent = contextMenu();
    thumbnail.dispatchEvent(imageEvent);

    expect(imageEvent.defaultPrevented).toBe(false);
    expect(showContextMenu).not.toHaveBeenCalled();
  });

  it("does not replace the editor's image paste event or open a second menu after cleanup", () => {
    const showContextMenu = installDesktopMenu();
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    cleanups.push(() => input.remove());
    const detach = attachComposerContextMenu(input);
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(["png"], "clipboard.png", { type: "image/png" }));
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(event.clipboardData?.files[0]?.name).toBe("clipboard.png");
    expect(showContextMenu).not.toHaveBeenCalled();
    detach();
    const contextEvent = contextMenu();
    input.dispatchEvent(contextEvent);
    expect(contextEvent.defaultPrevented).toBe(false);
    expect(showContextMenu).not.toHaveBeenCalled();
  });
});

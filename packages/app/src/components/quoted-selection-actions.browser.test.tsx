import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotedSelectionContextMenu } from "./quoted-selection-context-menu";

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-fine-pointer", () => ({ useShowPersistentActions: () => true }));
vi.mock("@/components/quick-ask-popover", () => ({ QuickAskPopover: () => null }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function answerQuestion() {
  return "answer";
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  window.getSelection()?.removeAllRanges();
  root = null;
  container = null;
});

async function mountTranscript() {
  const onQuote = vi.fn();
  container = document.createElement("div");
  container.style.cssText = "width: 900px; height: 500px; display: flex";
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QuotedSelectionContextMenu onQuote={onQuote} onAsk={answerQuestion}>
        <p data-testid="transcript-text">Selected transcript text</p>
        <div
          className="cm-editor"
          contentEditable
          suppressContentEditableWarning
          data-testid="editor"
        >
          Editable source text
        </div>
      </QuotedSelectionContextMenu>,
    );
  });
  return onQuote;
}

async function selectText(element: Element) {
  await act(async () => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

function getElement(selector: string): HTMLElement {
  const element = container?.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
  return element;
}

describe("explicit transcript selection actions", () => {
  it("quotes a native text selection without hover or right click", async () => {
    const onQuote = await mountTranscript();
    await selectText(getElement('[data-testid="transcript-text"]'));
    expect(window.getSelection()?.toString()).toBe("Selected transcript text");
    const quote = getElement('[data-testid="quoted-selection-action-quote"]');
    expect(quote.textContent).toBe("composer.attachments.quoteSelection");
    await userEvent.click(quote);
    expect(onQuote).toHaveBeenCalledExactlyOnceWith("Selected transcript text");
    expect(window.getSelection()?.toString()).toBe("");
  });

  it("invalidates the action when selection collapses or moves outside the transcript", async () => {
    await mountTranscript();
    await selectText(getElement('[data-testid="transcript-text"]'));
    expect(container?.querySelector('[data-testid="quoted-selection-actions"]')).not.toBeNull();
    await act(async () => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(container?.querySelector('[data-testid="quoted-selection-actions"]')).toBeNull();

    await selectText(getElement('[data-testid="transcript-text"]'));
    const outside = document.createElement("p");
    outside.textContent = "Outside";
    document.body.appendChild(outside);
    try {
      await selectText(outside);
      expect(container?.querySelector('[data-testid="quoted-selection-actions"]')).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it("does not hijack editor selection, native copy, or touch context menus", async () => {
    const onQuote = await mountTranscript();
    const transcript = getElement('[data-testid="transcript-text"]');
    await selectText(transcript);
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    transcript.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
    const touchMenu = new PointerEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
    });
    transcript.dispatchEvent(touchMenu);
    expect(touchMenu.defaultPrevented).toBe(false);
    expect(window.getSelection()?.toString()).toBe("Selected transcript text");

    const editor = getElement('[data-testid="editor"]');
    await act(async () => editor.focus());
    await selectText(editor);
    expect(container?.querySelector('[data-testid="quoted-selection-actions"]')).toBeNull();
    expect(onQuote).not.toHaveBeenCalled();
  });

  it("refuses a stale captured action even before selectionchange is delivered", async () => {
    const onQuote = await mountTranscript();
    await selectText(getElement('[data-testid="transcript-text"]'));
    const quote = getElement('[data-testid="quoted-selection-action-quote"]');
    await act(async () => {
      window.getSelection()?.removeAllRanges();
      quote.click();
    });
    expect(onQuote).not.toHaveBeenCalled();
  });
});

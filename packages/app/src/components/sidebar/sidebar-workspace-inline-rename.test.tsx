// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SidebarWorkspaceInlineRename } from "./sidebar-workspace-inline-rename";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

async function mountEditor(save: (title: string) => Promise<void>) {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Conversation() {
    const [title, setTitle] = useState("Original title");
    const [editing, setEditing] = useState(true);
    return editing ? (
      <SidebarWorkspaceInlineRename
        workspaceKey="server:workspace"
        rename={{
          initialValue: title,
          onSubmit: async (next) => {
            await save(next);
            setTitle(next);
          },
          onCancel: () => setEditing(false),
        }}
      />
    ) : (
      <span data-testid="saved-title">{title}</span>
    );
  }
  await act(async () => root.render(<Conversation />));
  const input = container.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("Inline rename input missing");
  return {
    container,
    input,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("Escape abandons edited text without saving the conversation title", async () => {
  const save = vi.fn(async () => {});
  const view = await mountEditor(save);
  try {
    expect(document.activeElement).toBe(view.input);
    fireEvent.change(view.input, { target: { value: "Unconfirmed title" } });
    fireEvent.keyDown(view.input, { key: "Escape" });
    await expect.poll(() => view.container.querySelector("input")).toBeNull();
    expect(view.container.querySelector('[data-testid="saved-title"]')?.textContent).toBe(
      "Original title",
    );
    expect(save).not.toHaveBeenCalled();
  } finally {
    await view.close();
  }
});

it("keeps a failed edit available for retry and submits at most once while saving", async () => {
  let fail!: (error: Error) => void;
  const pending = new Promise<void>((_, reject) => {
    fail = reject;
  });
  const save = vi
    .fn<(_: string) => Promise<void>>()
    .mockImplementationOnce(() => pending)
    .mockResolvedValue(undefined);
  const view = await mountEditor(save);
  try {
    fireEvent.change(view.input, { target: { value: "  First edit  " } });
    fireEvent.keyDown(view.input, { key: "Enter" });
    fireEvent.keyDown(view.input, { key: "Enter" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[data-testid="saved-title"]')).toBeNull();
    await act(async () => fail(new Error("Host disconnected")));
    await expect
      .poll(() => view.container.querySelector('[data-testid^="sidebar-workspace-rename-error-"]'))
      .not.toBeNull();
    expect(view.input.value).toBe("  First edit  ");
    fireEvent.change(view.input, { target: { value: "  Confirmed title  " } });
    fireEvent.keyDown(view.input, { key: "Enter" });
    await expect
      .poll(() => view.container.querySelector('[data-testid="saved-title"]')?.textContent)
      .toBe("Confirmed title");
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    await view.close();
  }
});

it("does not treat IME composition confirmation as a rename submission", async () => {
  const save = vi.fn(async () => {});
  const view = await mountEditor(save);
  try {
    fireEvent.change(view.input, { target: { value: "中文标题" } });
    act(() => {
      view.input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      view.input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
      );
    });
    expect(save).not.toHaveBeenCalled();
    expect(view.container.querySelector("input")).toBe(view.input);
    act(() => view.input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    fireEvent.keyDown(view.input, { key: "Enter" });
    await expect
      .poll(() => view.container.querySelector('[data-testid="saved-title"]')?.textContent)
      .toBe("中文标题");
  } finally {
    await view.close();
  }
});

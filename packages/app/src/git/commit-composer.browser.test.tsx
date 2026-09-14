import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { CommitComposer } from "./commit-composer";

const { commit, generate, toast } = vi.hoisted(() => ({
  commit: vi.fn(async () => {}),
  generate: vi.fn(
    async () =>
      "feat: add context selection\n\n- Let users include conversation context.\n- Preserve the selected option when asking about quoted text.",
  ),
  toast: { show: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        server: {
          client: { generateCheckoutCommitMessage: generate },
          serverInfo: { features: { checkoutCommitMessageGeneration: true } },
        },
      },
    }),
}));
vi.mock("@/git/actions-store", () => ({
  useCheckoutGitActionsStore: (selector: (state: unknown) => unknown) =>
    selector({
      commit,
      getStatus: () => "idle",
    }),
}));

it("preserves generated body text and inserts newlines without submitting until Commit is clicked", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  container.style.width = "380px";
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<CommitComposer serverId="server" cwd="/repo" branchName="main" hasChanges />),
    );
    await userEvent.click(
      container.querySelector('[data-testid="changes-generate-commit-message"]')!,
    );
    const input = container.querySelector("textarea")!;
    const generated = await generate.mock.results[0].value;
    await expect.poll(() => input.value).toBe(generated);
    await expect.poll(() => input.getBoundingClientRect().height).toBeGreaterThan(34);
    await userEvent.click(input);
    input.setSelectionRange(input.value.length, input.value.length);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => input.value).toBe(`${generated}\n`);
    expect(commit).not.toHaveBeenCalled();
    await userEvent.type(input, "- Keep the context choice editable.");
    const completeMessage = input.value.trim();
    await userEvent.click(container.querySelector('[data-testid="changes-commit-button"]')!);
    await expect.poll(() => commit.mock.calls.length).toBe(1);
    expect(commit).toHaveBeenCalledWith({
      serverId: "server",
      cwd: "/repo",
      message: completeMessage,
    });
    await expect.poll(() => input.value).toBe("");
    await expect.poll(() => input.getBoundingClientRect().height).toBe(34);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("grows with its content, caps at 300px, and shrinks after content is removed", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  container.style.width = "380px";
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<CommitComposer serverId="server" cwd="/repo" branchName="main" hasChanges />),
    );
    const input = container.querySelector("textarea")!;
    expect(Number.parseFloat(getComputedStyle(input).fontSize)).toBe(16);
    expect(input.getBoundingClientRect().height).toBe(34);

    await userEvent.fill(
      input,
      Array.from({ length: 40 }, (_, index) => `Commit message line ${index + 1}`).join("\n"),
    );
    await expect.poll(() => input.getBoundingClientRect().height).toBe(300);

    for (let index = 0; index < 3; index += 1) {
      await act(async () => input.blur());
      await act(async () => input.focus());
    }
    expect(input.value).toContain("Commit message line 40");
    expect(input.getBoundingClientRect().height).toBe(300);

    await userEvent.fill(input, "Short message");
    await expect.poll(() => input.getBoundingClientRect().height).toBe(34);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

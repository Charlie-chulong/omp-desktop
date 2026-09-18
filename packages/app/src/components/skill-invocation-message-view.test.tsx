/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("lucide-react-native", () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

import { SkillInvocationMessageView } from "./skill-invocation-message-view";

it("keeps expanded skill instructions hidden until requested", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const message = [
    '[IMPORTANT: User invoked the "shannon" skill; follow its instructions. Full skill below.]',
    "",
    "SECRET SKILL BODY",
    "",
    "---",
    "",
    "[Skill directory: /skills/shannon]",
    "Resolve relative paths in this skill against this absolute directory.",
    "User: inspect this account",
  ].join("\n");
  const invocation = { name: "shannon", userArguments: "inspect this account" };

  try {
    await act(async () =>
      root.render(React.createElement(SkillInvocationMessageView, { message, invocation })),
    );

    const toggle = container.querySelector('[data-testid="user-message-skill-toggle"]');
    expect(container.textContent).toContain("/shannon");
    expect(container.textContent).toContain("inspect this account");
    expect(container.textContent).not.toContain("SECRET SKILL BODY");

    await act(async () => {
      (toggle as HTMLElement).click();
    });
    expect(container.querySelector('[data-testid="user-message-skill-content"]')).not.toBeNull();
    expect(container.textContent).toContain("SECRET SKILL BODY");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

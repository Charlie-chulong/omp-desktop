// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useWorkspaceTerminalSessionRetention } from "./use-workspace-terminal-session-retention";
import { getWorkspaceTerminalSession } from "../runtime/workspace-terminal-session";

it("preserves a checkout's terminal output when sibling checkouts change, and releases only removed scopes", () => {
  const a = "retention-project:checkout-a";
  const b = "retention-project:checkout-b";
  const c = "retention-project:checkout-c";
  const { rerender, unmount } = renderHook(
    ({ scopeKeys }) => useWorkspaceTerminalSessionRetention({ scopeKeys }),
    { initialProps: { scopeKeys: [a, b] } },
  );
  const output = {
    rows: 1,
    cols: 1,
    grid: [[{ char: "A" }]],
    scrollback: [],
    cursor: { row: 0, col: 0 },
  };
  for (const scopeKey of [a, b]) {
    getWorkspaceTerminalSession({ scopeKey }).snapshots.set({
      terminalId: "terminal",
      state: output,
    });
  }
  rerender({ scopeKeys: [b, a] });
  expect(
    getWorkspaceTerminalSession({ scopeKey: a }).snapshots.get({ terminalId: "terminal" }),
  ).toEqual(output);
  rerender({ scopeKeys: [a, c] });
  expect(
    getWorkspaceTerminalSession({ scopeKey: a }).snapshots.get({ terminalId: "terminal" }),
  ).toEqual(output);
  expect(
    getWorkspaceTerminalSession({ scopeKey: b }).snapshots.get({ terminalId: "terminal" }),
  ).toBeNull();
  unmount();
  expect(
    getWorkspaceTerminalSession({ scopeKey: a }).snapshots.get({ terminalId: "terminal" }),
  ).toBeNull();
});

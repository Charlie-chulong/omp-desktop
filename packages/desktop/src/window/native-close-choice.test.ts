import type { BrowserWindow, MessageBoxReturnValue } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  promptForNativeCloseChoice,
  type NativeCloseChoiceDependencies,
  type StoredCloseBehavior,
} from "./native-close-choice.js";

const window = {} as BrowserWindow;
function createDependencies(
  closeBehavior: StoredCloseBehavior,
  result: MessageBoxReturnValue = { response: 0, checkboxChecked: false },
) {
  return {
    getCloseBehavior: vi.fn(async () => closeBehavior),
    showMessageBox: vi.fn(async () => result),
    rememberCloseBehavior: vi.fn(async () => undefined),
    onRememberError: vi.fn(),
  } satisfies NativeCloseChoiceDependencies;
}

describe("native close choice", () => {
  it("applies a stored close behavior without interrupting the close action", async () => {
    const dependencies = createDependencies("background");

    await expect(promptForNativeCloseChoice(window, dependencies)).resolves.toBe("background");
    expect(dependencies.showMessageBox).not.toHaveBeenCalled();
  });

  it.each([
    [0, "background"],
    [1, "quit"],
    [2, "cancel"],
    [-1, "cancel"],
  ] as const)("maps native response %s to %s", async (response, expected) => {
    const dependencies = createDependencies("ask", { response, checkboxChecked: false });

    await expect(promptForNativeCloseChoice(window, dependencies)).resolves.toBe(expected);
  });

  it("remembers a confirmed background choice", async () => {
    const dependencies = createDependencies("ask", { response: 0, checkboxChecked: true });

    await expect(promptForNativeCloseChoice(window, dependencies)).resolves.toBe("background");
    expect(dependencies.rememberCloseBehavior).toHaveBeenCalledWith("background");
  });

  it("still closes when persisting the remembered choice fails", async () => {
    const dependencies = createDependencies("ask", { response: 1, checkboxChecked: true });
    const error = new Error("settings unavailable");
    dependencies.rememberCloseBehavior.mockRejectedValue(error);

    await expect(promptForNativeCloseChoice(window, dependencies)).resolves.toBe("quit");
    expect(dependencies.onRememberError).toHaveBeenCalledWith(error);
  });
});

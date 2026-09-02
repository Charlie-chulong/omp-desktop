// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn(() => Promise.resolve());
const useContextWindow = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-omp-model-context-window", () => ({
  useOmpModelContextWindow: (...args: unknown[]) => useContextWindow(...args),
}));
vi.mock("@/components/adaptive-text-input", () => ({
  AdaptiveTextInput: ({
    initialValue,
    onChangeText,
    accessibilityLabel,
    ...props
  }: {
    initialValue?: string;
    onChangeText?: (value: string) => void;
    accessibilityLabel?: string;
  }) => (
    <input
      {...props}
      aria-label={accessibilityLabel}
      defaultValue={initialValue}
      onChange={(event) => onChangeText?.(event.currentTarget.value)}
    />
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress, disabled }: React.PropsWithChildren<{ onPress?: () => void; disabled?: boolean }>) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

import { ModelContextWindowControl } from "./model-context-window-control";

describe("ModelContextWindowControl", () => {
  beforeEach(() => {
    save.mockClear();
    useContextWindow.mockReturnValue({
      canEdit: true,
      reportedContextWindow: 128_000,
      contextWindowOverride: 128_000,
      isSaving: false,
      error: null,
      save,
    });
  });

  it("edits context windows in k units and keeps the unit inside the input", () => {
    render(
      <ModelContextWindowControl
        serverId="server"
        provider="omp"
        modelId="openai/model"
        enabled
      />,
    );

    fireEvent.click(screen.getByText("modelSelector.contextWindowEdit"));

    const input = screen.getByLabelText(
      "modelSelector.contextWindowInputAccessibility (k)",
    ) as HTMLInputElement;
    expect(input.value).toBe("128");
    expect(input.parentElement?.textContent).toContain("k");
    expect(input.getAttribute("placeholder")).toBe("modelSelector.contextWindowUseDefault");

    fireEvent.change(input, { target: { value: "64.5" } });
    fireEvent.click(screen.getByText("modelSelector.contextWindowSave"));

    expect(save).toHaveBeenCalledWith(64_500);
  });
});

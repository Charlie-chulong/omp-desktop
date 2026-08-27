// @vitest-environment jsdom
import React, { type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormPreferences } from "@/create-agent-preferences/preferences";

const service = vi.hoisted(() => ({
  current: {} as FormPreferences,
  resolveUpdate: null as ((value: FormPreferences) => void) | null,
  load: vi.fn(async () => service.current),
  update: vi.fn(
    (update: Partial<FormPreferences> | ((current: FormPreferences) => FormPreferences)) =>
      new Promise<FormPreferences>((resolve) => {
        service.current =
          typeof update === "function"
            ? update(service.current)
            : { ...service.current, ...update };
        service.resolveUpdate = resolve;
      }),
  ),
}));

vi.mock("@/create-agent-preferences/service", () => ({
  createAgentPreferencesService: service,
}));

import { mergeProviderPreferences, useFormPreferences } from "./use-form-preferences";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useFormPreferences", () => {
  afterEach(() => {
    cleanup();
    service.current = {};
    service.resolveUpdate = null;
    service.load.mockClear();
    service.update.mockClear();
  });

  it("publishes a mode selection before storage finishes so a new composer inherits it", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(useFormPreferences, { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let persistence: Promise<FormPreferences> | undefined;
    act(() => {
      persistence = result.current.updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: "omp",
          updates: { mode: "full" },
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.preferences.providerPreferences?.omp?.mode).toBe("full"),
    );
    expect(service.resolveUpdate).not.toBeNull();

    await act(async () => {
      service.resolveUpdate?.(service.current);
      await persistence;
    });
    queryClient.clear();
  });
});

/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MetadataGenerationPage } from "./metadata-generation-page";

const { patchConfig } = vi.hoisted(() => ({
  patchConfig: vi.fn(async () => ({ requestId: "settings", config: {} })),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: {
      metadataGeneration: {
        providers: [],
        commitMessageProviders: [{ provider: "omp", model: "commit-model" }],
      },
      quickAsk: { providers: [{ provider: "omp", model: "quick-ask-model" }] },
    },
    isLoading: false,
    patchConfig,
  }),
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: [],
    isLoading: false,
    isFetching: false,
    isRefreshing: false,
    refetchIfStale: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/combined-model-selector", () => ({
  CombinedModelSelector: ({ selectedModel }: { selectedModel: string }) => (
    <div data-testid={`model-${selectedModel}`} />
  ),
}));

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  patchConfig.mockClear();
  vi.unstubAllGlobals();
});

it("shows independent metadata, commit-message, and Quick Ask model controls", () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MetadataGenerationPage serverId="server" />));
  mounted.push({ root, container });

  expect(container.querySelector('[data-testid="metadata-generation-mode"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="commit-message-generation-mode"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="quick-ask-generation-mode"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="model-commit-model"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="model-quick-ask-model"]')).not.toBeNull();
});

it("switches only commit-message generation back to automatic", async () => {
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MetadataGenerationPage serverId="server" />));
  mounted.push({ root, container });

  const control = container.querySelector('[data-testid="commit-message-generation-mode"]');
  const automatic = control?.querySelector("[role=button]");
  if (!(automatic instanceof HTMLElement)) {
    throw new Error("Commit-message automatic option did not render");
  }
  await act(async () => automatic.click());

  expect(patchConfig).toHaveBeenCalledWith({
    metadataGeneration: { commitMessageProviders: [] },
  });
  expect(patchConfig).not.toHaveBeenCalledWith({ metadataGeneration: { providers: [] } });
  expect(patchConfig).not.toHaveBeenCalledWith({ quickAsk: { providers: [] } });
});

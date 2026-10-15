/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OmpProviderManagement } from "@omp-desktop/protocol/messages";
import { en } from "@/i18n/resources/en";
import { ContextWindowMeter } from "./context-window-meter";

const runtime = vi.hoisted(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      media,
      matches: false,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  );
  return { getManagement: vi.fn<() => Promise<OmpProviderManagement>>() };
});
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({
      sessions: {
        "quota-host": {
          client: { getOmpProviderManagement: runtime.getManagement },
          serverInfo: { features: { ompProviderManagement: true } },
        },
      },
    }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => null,
  useHostRuntimeIsConnected: () => false,
}));
vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: { ompProviderAccountNotes: {} }, isLoading: false }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
// Use the actual web adaptive overlay: the shared native sheet stub does not render content.
// No quota hook, trigger, sheet, or usage renderer is replaced by a forwarding mock.
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  runtime.getManagement.mockReset();
  vi.unstubAllGlobals();
  document.getElementById("overlay-root")?.remove();
});

test.each([
  { label: "a selected credential", selectedId: "71", otherAccountVisible: false },
  {
    label: "separately labelled unselected accounts",
    selectedId: undefined,
    otherAccountVisible: true,
  },
])(
  "a press opens $label before context tokens and reopens with fresh usage",
  async ({ selectedId, otherAccountVisible }) => {
    const management: OmpProviderManagement = {
      configPath: "/test/models.yml",
      configYaml: "",
      providerModels: [],
      loginProviders: [
        {
          id: "anthropic",
          name: "Claude",
          available: true,
          authenticated: true,
          accounts: [
            {
              credentialId: 71,
              accountNumber: 1,
              quota: { status: "available", fiveHourUsedPct: 25 },
            },
            {
              credentialId: 72,
              accountNumber: 2,
              quota: { status: "available", fiveHourUsedPct: 90 },
            },
          ],
        },
      ],
    };
    runtime.getManagement.mockResolvedValue(management);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const i18n = createInstance();
    await i18n.init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <ContextWindowMeter
            serverId="quota-host"
            provider="anthropic"
            accountCredentialId={selectedId}
            accountCredentialIds={["71", "72"]}
            maxTokens={null}
            usedTokens={null}
          />
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(runtime.getManagement).not.toHaveBeenCalled();
    const entry = screen.getByRole("button", { name: "Claude usage" });
    fireEvent.click(entry); // The normal touch-generated click; no hover/long-press is dispatched.
    await screen.findByText("75%");
    expect(Boolean(screen.queryByText("10%"))).toBe(otherAccountVisible);
    expect(Boolean(screen.queryByText("Claude · Account 2"))).toBe(otherAccountVisible);
    expect(screen.queryByText("Context window")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const refreshed = structuredClone(management);
    for (const provider of refreshed.loginProviders) {
      for (const account of provider.accounts ?? []) {
        account.quota = { status: "available", fiveHourUsedPct: 40 };
      }
    }
    runtime.getManagement.mockResolvedValue(refreshed);
    fireEvent.click(entry);
    await waitFor(() =>
      expect(screen.getAllByText("60%")).toHaveLength(otherAccountVisible ? 2 : 1),
    );
    expect(screen.queryByText("75%")).toBeNull();
  },
);

import { describe, expect, it } from "vitest";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  groupOmpModelsByProviderNamespace,
  isModelBrowserRowSelected,
  resolveModelBrowserProviderId,
  resolveModelBrowserProviderNamespaceId,
  resolveModelBrowserScrolling,
  resolveModelSheetOpening,
} from "./model-sheet-flow";

function providerFixture(id: string, label: string): ProviderSelectorProvider {
  return { id, label, modelSelection: { kind: "models", rows: [] } };
}

function runtimeProviderIds(providers: ProviderSelectorProvider[]): string[] {
  const ids: string[] = [];
  for (const entry of providers) {
    if (entry.modelSelection.kind !== "models") continue;
    for (const row of entry.modelSelection.rows) ids.push(row.provider);
  }
  return ids;
}

const omp = providerFixture("omp", "Oh My Pi");

describe("model sheet opening", () => {
  it("opens the sole OMP provider directly", () => {
    expect(
      resolveModelSheetOpening({
        canSwitchProvider: true,
        providers: [omp],
        selectedProvider: "omp",
      }),
    ).toEqual({ kind: "provider", providerId: "omp", providerLabel: "Oh My Pi" });
  });

  it("opens a running OMP agent directly at its fixed provider", () => {
    expect(
      resolveModelSheetOpening({
        canSwitchProvider: false,
        providers: [omp],
        selectedProvider: "omp",
      }),
    ).toEqual({ kind: "provider", providerId: "omp", providerLabel: "Oh My Pi" });
  });

  it("falls back to OMP while live state catches up", () => {
    expect(
      resolveModelSheetOpening({
        canSwitchProvider: false,
        providers: [omp],
        selectedProvider: "",
      }),
    ).toEqual({ kind: "provider", providerId: "omp", providerLabel: "Oh My Pi" });
  });
});

describe("OMP model provider grouping", () => {
  it("shows model namespaces as first-level providers while keeping OMP as the runtime", () => {
    const providers = groupOmpModelsByProviderNamespace([
      {
        id: "omp",
        label: "Oh My Pi",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "omp:cursor/gpt-5",
              provider: "omp",
              providerLabel: "Oh My Pi",
              modelId: "cursor/gpt-5",
              modelLabel: "GPT-5",
            },
            {
              favoriteKey: "omp:openai/gpt-5.4",
              provider: "omp",
              providerLabel: "Oh My Pi",
              modelId: "openai/gpt-5.4",
              modelLabel: "GPT-5.4",
            },
          ],
        },
      },
    ]);

    expect(providers.map((entry) => [entry.id, entry.label])).toEqual([
      ["omp:cursor", "Cursor"],
      ["omp:openai", "OpenAI"],
    ]);
    expect(runtimeProviderIds(providers)).toEqual(["omp", "omp"]);
  });

  it("resolves the selected live OMP model to its grouped provider", () => {
    const providers = groupOmpModelsByProviderNamespace([
      {
        id: "omp",
        label: "Oh My Pi",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "omp:cursor/gpt-5",
              provider: "omp",
              providerLabel: "Oh My Pi",
              modelId: "cursor/gpt-5",
              modelLabel: "GPT-5",
            },
            {
              favoriteKey: "omp:openai-codex/gpt-5.6-sol",
              provider: "omp",
              providerLabel: "Oh My Pi",
              modelId: "openai-codex/gpt-5.6-sol",
              modelLabel: "GPT-5.6-Sol",
            },
          ],
        },
      },
    ]);

    expect(resolveModelBrowserProviderId("omp", "openai-codex/gpt-5.6-sol", providers)).toBe(
      "omp:openai-codex",
    );
  });
  it("resolves grouped OMP provider ids to their underlying namespace", () => {
    expect(resolveModelBrowserProviderNamespaceId("omp:cursor")).toBe("cursor");
    expect(resolveModelBrowserProviderNamespaceId("omp:openai-codex")).toBe("openai-codex");
    expect(resolveModelBrowserProviderNamespaceId("cursor")).toBe("cursor");
    expect(resolveModelBrowserProviderNamespaceId("omp", "mintcat/gpt-5")).toBe("mintcat");
  });

  it("marks a selected model inside its grouped virtual provider", () => {
    expect(
      isModelBrowserRowSelected(
        "omp",
        "openai-codex/gpt-5.6-sol",
        "omp:openai-codex",
        "openai-codex/gpt-5.6-sol",
      ),
    ).toBe(true);
    expect(
      isModelBrowserRowSelected(
        "omp",
        "openai-codex/gpt-5.4",
        "omp:openai-codex",
        "openai-codex/gpt-5.6-sol",
      ),
    ).toBe(false);
  });
});

describe("model sheet gesture ownership", () => {
  it("uses the sheet-aware model browser inside compact bottom sheets", () => {
    expect(resolveModelBrowserScrolling(true)).toBe("sheet");
  });

  it("keeps independent scrolling in the desktop split viewport", () => {
    expect(resolveModelBrowserScrolling(false)).toBe("independent");
  });
});

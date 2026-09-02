import { describe, expect, it } from "vitest";
import { resolveOmpModelContextTarget } from "./use-omp-model-context-window";

describe("OMP model context-window target", () => {
  it("maps a grouped OMP model id to its provider and native model id", () => {
    expect(resolveOmpModelContextTarget("omp", "openai-codex/gpt-5.6-sol")).toEqual({
      providerId: "openai-codex",
      modelId: "gpt-5.6-sol",
    });
    expect(resolveOmpModelContextTarget("omp", "vertex/publisher/model")).toEqual({
      providerId: "vertex",
      modelId: "publisher/model",
    });
  });

  it("does not expose the native management control for other runtimes or invalid ids", () => {
    expect(resolveOmpModelContextTarget("codex", "openai-codex/gpt-5.6-sol")).toBeNull();
    expect(resolveOmpModelContextTarget("omp", "openai-codex")).toBeNull();
    expect(resolveOmpModelContextTarget("omp", "")).toBeNull();
  });
});

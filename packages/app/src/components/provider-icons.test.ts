import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("lucide-react-native", () => ({ Bot: () => null }));
vi.mock("@/components/icons/omp-icon", () => ({ OmpIcon: () => null }));

import { resolveProviderMonogram } from "./provider-icons";

describe("resolveProviderMonogram", () => {
  it("uses compact recognizable marks for grouped OMP model providers", () => {
    expect(resolveProviderMonogram("omp:openai")).toBe("AI");
    expect(resolveProviderMonogram("omp:anthropic")).toBe("A");
    expect(resolveProviderMonogram("omp:google")).toBe("G");
  });

  it("derives a bounded fallback without replacing the OMP mark", () => {
    expect(resolveProviderMonogram("omp:custom-provider")).toBe("CP");
    expect(resolveProviderMonogram("omp")).toBeNull();
  });
});

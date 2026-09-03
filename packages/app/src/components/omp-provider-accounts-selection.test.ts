import { describe, expect, test } from "vitest";
import {
  isOmpAutomaticAccountOption,
  orderOmpAccountFeatureOptions,
  resolveOmpAccountFeatureSelection,
} from "./omp-provider-accounts";

describe("OMP account feature selection", () => {
  test("identifies automatic option by metadata", () => {
    expect(
      isOmpAutomaticAccountOption({
        id: "automatic",
        label: "Automatic",
        metadata: { selectionMode: "automatic" },
      }),
    ).toBe(true);
    expect(isOmpAutomaticAccountOption({ id: "42", label: "Account 42" })).toBe(false);
  });

  test("orders automatic option first", () => {
    const options = [
      { id: "41", label: "Account 41" },
      { id: "automatic", label: "Automatic", metadata: { selectionMode: "automatic" } },
      { id: "42", label: "Account 42" },
    ];
    const ordered = orderOmpAccountFeatureOptions(options);
    expect(ordered[0]?.id).toBe("automatic");
    expect(ordered.map((opt) => opt.id)).toEqual(["automatic", "41", "42"]);
  });

  test("resolves automatic selection when value is null", () => {
    const selection = resolveOmpAccountFeatureSelection({
      value: null,
      options: [
        { id: "automatic", label: "Automatic", metadata: { selectionMode: "automatic" } },
        { id: "41", label: "Account 41" },
      ],
    });
    expect(selection.isAutomatic).toBe(true);
    expect(selection.configuredValue).toBe("automatic");
    expect(selection.effectiveValue).toBe("");
  });

  test("resolves automatic selection when value matches automatic option", () => {
    const selection = resolveOmpAccountFeatureSelection({
      value: "automatic",
      options: [
        { id: "automatic", label: "Automatic", metadata: { selectionMode: "automatic" } },
        { id: "41", label: "Account 41" },
      ],
    });
    expect(selection.isAutomatic).toBe(true);
    expect(selection.configuredValue).toBe("automatic");
  });

  test("resolves manual selection with effective value", () => {
    const selection = resolveOmpAccountFeatureSelection({
      value: "42",
      effectiveValue: "42",
      options: [
        { id: "automatic", label: "Automatic", metadata: { selectionMode: "automatic" } },
        { id: "41", label: "Account 41" },
        { id: "42", label: "Account 42" },
      ],
    });
    expect(selection.isAutomatic).toBe(false);
    expect(selection.configuredValue).toBe("42");
    expect(selection.effectiveValue).toBe("42");
  });

  test("resolves automatic selection with effective value during resolution", () => {
    const selection = resolveOmpAccountFeatureSelection({
      value: "automatic",
      effectiveValue: "41",
      options: [
        { id: "automatic", label: "Automatic", metadata: { selectionMode: "automatic" } },
        { id: "41", label: "Account 41" },
        { id: "42", label: "Account 42" },
      ],
    });
    expect(selection.isAutomatic).toBe(true);
    expect(selection.configuredValue).toBe("automatic");
    expect(selection.effectiveValue).toBe("41");
  });
});

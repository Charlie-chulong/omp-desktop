import { describe, expect, test } from "vitest";
import {
  getOmpBuiltinToolNames,
  OMP_BUILTIN_TOOL_NAMES,
  OMP_LEGACY_BUILTIN_TOOL_NAMES,
} from "./omp-builtin-tools.js";

describe("OMP built-in tool catalogs", () => {
  test("accepts the product-prefixed versions returned by the installation status", () => {
    expect(getOmpBuiltinToolNames("omp/18.3.0")).toBe(OMP_BUILTIN_TOOL_NAMES);
    expect(getOmpBuiltinToolNames("omp/18.2.10")).toBe(OMP_LEGACY_BUILTIN_TOOL_NAMES);
  });

  test("does not advertise a catalog for an unverified release", () => {
    expect(getOmpBuiltinToolNames("omp/18.4.0")).toBeNull();
    expect(getOmpBuiltinToolNames(undefined)).toBeNull();
  });
});

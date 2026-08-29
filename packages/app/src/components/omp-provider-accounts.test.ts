import { describe, expect, test } from "vitest";

import { formatOmpAccountIdentity, resolveOmpLoginAction } from "./omp-provider-accounts";

describe("OMP provider accounts", () => {
  test("keeps login available after the first account authenticates", () => {
    expect(resolveOmpLoginAction({ available: true, authenticated: false })).toBe("sign-in");
    expect(resolveOmpLoginAction({ available: true, authenticated: true })).toBe("add-account");
    expect(resolveOmpLoginAction({ available: false, authenticated: true })).toBeNull();
  });

  test("shows account email while preserving organization qualifiers", () => {
    expect(formatOmpAccountIdentity("email:alice@example.com|org:org-team")).toEqual({
      primary: "alice@example.com",
      secondary: "org:org-team",
    });
    expect(formatOmpAccountIdentity("workspace:enterprise")).toEqual({
      primary: "workspace:enterprise",
      secondary: null,
    });
    expect(formatOmpAccountIdentity()).toEqual({ primary: null, secondary: null });
  });
});

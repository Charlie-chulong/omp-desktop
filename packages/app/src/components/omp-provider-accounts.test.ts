import { describe, expect, test } from "vitest";

import {
  formatOmpAccountIdentity,
  formatOmpAccountSelectionLabel,
  resolveOmpLoginAction,
  selectOmpQuotaAccounts,
} from "./omp-provider-accounts";

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

  test("shows account notes before email addresses in selectors", () => {
    expect(
      formatOmpAccountSelectionLabel({
        note: "  个人订阅  ",
        identityKey: "email:alice@example.com|org:org-team",
        fallback: "OAuth credential #4",
      }),
    ).toBe("个人订阅 · alice@example.com");
    expect(
      formatOmpAccountSelectionLabel({
        identityKey: "email:alice@example.com|org:org-team",
        fallback: "OAuth credential #4",
      }),
    ).toBe("alice@example.com");
    expect(
      formatOmpAccountSelectionLabel({
        note: "个人订阅",
        fallback: "OAuth credential #4",
      }),
    ).toBe("个人订阅");
    expect(
      formatOmpAccountSelectionLabel({
        fallback: "OAuth credential #4",
      }),
    ).toBe("OAuth credential #4");
  });

  test("shows only the selected account quota when multiple accounts exist", () => {
    const accounts = [{ credentialId: 1 }, { credentialId: 2 }];

    expect(selectOmpQuotaAccounts(accounts, 2)).toEqual([{ credentialId: 2 }]);
    expect(selectOmpQuotaAccounts(accounts, null)).toEqual([]);
    expect(selectOmpQuotaAccounts([accounts[0]], null)).toEqual([{ credentialId: 1 }]);
  });
});

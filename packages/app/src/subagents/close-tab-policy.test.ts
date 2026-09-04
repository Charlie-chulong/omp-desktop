import { describe, expect, it } from "vitest";
import { resolveCloseAgentTabPolicy } from "./close-tab-policy";

describe("resolveCloseAgentTabPolicy", () => {
  it("keeps root agent tabs active and clears their open-tab label", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: null })).toEqual({
      kind: "layout-only",
      syncOpenLabel: true,
    });
  });

  it("keeps subagent tab close layout-only and clears its open-tab label", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent" })).toEqual({
      kind: "layout-only",
      syncOpenLabel: true,
    });
  });

  it("closes missing-agent tabs locally without updating the deleted agent", () => {
    expect(resolveCloseAgentTabPolicy(null)).toEqual({
      kind: "layout-only",
      syncOpenLabel: false,
    });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({
      kind: "layout-only",
      syncOpenLabel: false,
    });
  });
});

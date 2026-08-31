import { describe, expect, it } from "vitest";
import { resolveCloseAgentTabPolicy } from "./close-tab-policy";

describe("resolveCloseAgentTabPolicy", () => {
  it("keeps root agent tabs active when they close", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: null })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps subagent tab close layout-only", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent" })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps missing-agent tabs active when they close", () => {
    expect(resolveCloseAgentTabPolicy(null)).toEqual({ kind: "layout-only" });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({ kind: "layout-only" });
  });
});

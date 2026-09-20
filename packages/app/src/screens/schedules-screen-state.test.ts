import { describe, expect, it } from "vitest";
import { resolveSchedulesScreenBodyState } from "./schedules-screen-state";

describe("resolveSchedulesScreenBodyState", () => {
  it("routes failed loading state to the retry UI instead of the spinner", () => {
    expect(
      resolveSchedulesScreenBodyState({
        loadState: { status: "loading" },
        showLoadError: true,
      }),
    ).toEqual({ kind: "load-error" });
  });

  it("routes connecting to the empty CTA instead of a blocking spinner", () => {
    expect(
      resolveSchedulesScreenBodyState({
        loadState: { status: "connecting" },
        showLoadError: false,
      }),
    ).toEqual({ kind: "empty" });
  });

  it("keeps the spinner only while the query has no payload yet", () => {
    expect(
      resolveSchedulesScreenBodyState({
        loadState: { status: "loading" },
        showLoadError: false,
      }),
    ).toEqual({ kind: "loading" });
  });
});

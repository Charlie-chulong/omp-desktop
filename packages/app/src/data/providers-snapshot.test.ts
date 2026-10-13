import { describe, expect, it } from "vitest";
import {
  providersSnapshotQueryKey,
  providersSnapshotQueryRoot,
  providersSnapshotRequestOptions,
} from "@/data/providers-snapshot";

describe("global providers snapshot", () => {
  it("uses one shared query under each host root", () => {
    expect(providersSnapshotQueryKey("server-1")).toEqual(["providersSnapshot", "server-1"]);
    expect(providersSnapshotQueryKey("server-1")).toEqual(providersSnapshotQueryRoot("server-1"));
    expect(providersSnapshotQueryKey("server-2")).not.toEqual(
      providersSnapshotQueryKey("server-1"),
    );
  });

  it("only sends catalog refresh and conditional-fetch options", () => {
    expect(providersSnapshotRequestOptions({})).toEqual({});
    expect(providersSnapshotRequestOptions({ providers: ["codex"] })).toEqual({
      providers: ["codex"],
    });
    expect(
      providersSnapshotRequestOptions({ providers: ["codex"], ifNoneMatch: "snapshot-hash" }),
    ).toEqual({ providers: ["codex"], ifNoneMatch: "snapshot-hash" });
  });
});

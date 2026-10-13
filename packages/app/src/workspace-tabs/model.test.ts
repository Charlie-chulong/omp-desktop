import { describe, expect, it } from "vitest";
import { buildProjectLayoutKey, buildWorkspaceTabPersistenceKey } from "./model";

describe("buildWorkspaceTabPersistenceKey", () => {
  it("trims and joins opaque server and workspace ids", () => {
    expect(
      buildWorkspaceTabPersistenceKey({
        serverId: "  server-1  ",
        workspaceId: "  setup\\workspace\\  ",
      }),
    ).toBe("server-1:setup\\workspace\\");
  });

  it("rejects incomplete identities", () => {
    expect(buildWorkspaceTabPersistenceKey({ serverId: "", workspaceId: "workspace" })).toBeNull();
    expect(buildWorkspaceTabPersistenceKey({ serverId: "server", workspaceId: "  " })).toBeNull();
  });
});

describe("buildProjectLayoutKey", () => {
  it("encodes opaque project identities without confusing workspace metadata keys", () => {
    expect(buildProjectLayoutKey({ serverId: " host ", projectId: " a/b:c " })).toBe(
      "host:project:a%2Fb%3Ac",
    );
    expect(buildWorkspaceTabPersistenceKey({ serverId: "host", workspaceId: "a/b:c" })).toBe(
      "host:a/b:c",
    );
  });

  it("does not create a shared key for missing projects", () => {
    expect(buildProjectLayoutKey({ serverId: "host", projectId: "  " })).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsView } from "./settings-navigation";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  dismissTo: vi.fn(),
  navigateToLastWorkspace: vi.fn(),
}));
vi.mock("expo-router", () => ({ router: navigation }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToLastWorkspace: navigation.navigateToLastWorkspace,
}));

import { getSettingsHostSwitchRoute, returnFromSettings } from "./settings-navigation";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settings host switching", () => {
  it("opens the target host's project list rather than reusing a host-scoped project ID", () => {
    const view: SettingsView = {
      kind: "project",
      serverId: "old-host",
      projectId: "only-on-old-host",
    };
    expect(getSettingsHostSwitchRoute(view, "new host")).toBe(
      "/settings/hosts/new%20host/projects",
    );
  });

  it.each(["host", "memory", "metadata", "providers", "image-generation", "usage"] as const)(
    "keeps the selected %s host section when changing hosts",
    (section) => {
      expect(
        getSettingsHostSwitchRoute({ kind: "host", serverId: "old-host", section }, "new-host"),
      ).toBe(`/settings/hosts/new-host/${section}`);
    },
  );

  it.each<SettingsView>([
    { kind: "root" },
    { kind: "section", section: "general" },
    { kind: "section", section: "chat-behavior" },
    { kind: "section", section: "connections" },
    { kind: "section", section: "appearance" },
  ])("leaves app-scoped settings in place when choosing a host: %j", (view) => {
    expect(getSettingsHostSwitchRoute(view, "new-host")).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("returning from settings", () => {
  it("keeps project back navigation scoped to the current host", () => {
    returnFromSettings({ kind: "project", serverId: "new host", projectId: "project" });
    expect(navigation.dismissTo).toHaveBeenCalledWith("/settings/hosts/new%20host/projects");
  });

  it("returns from chat behavior to the settings root", () => {
    returnFromSettings({ kind: "section", section: "chat-behavior" });
    expect(navigation.dismissTo).toHaveBeenCalledWith("/settings");
  });

  it("returns to the last workspace when leaving settings", () => {
    navigation.navigateToLastWorkspace.mockReturnValue(true);
    returnFromSettings({ kind: "root" });
    expect(navigation.navigateToLastWorkspace).toHaveBeenCalledOnce();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("uses the project chooser when the last workspace is unavailable", () => {
    navigation.navigateToLastWorkspace.mockReturnValue(false);
    returnFromSettings({ kind: "root" });
    expect(navigation.replace).toHaveBeenCalledWith("/open-project");
  });
});

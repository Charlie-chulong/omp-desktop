/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";

const route = vi.hoisted(() => ({
  local: { serverId: "intent-host", workspaceId: "new", open: undefined as string | undefined },
  global: { open: "agent:archived-agent" },
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => route.local,
  useGlobalSearchParams: () => route.global,
  useRootNavigationState: () => ({ key: "root" }),
  usePathname: () => "/h/intent-host/workspace/new",
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ setParams: vi.fn() }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));
vi.mock("@/components/host-route-bootstrap-boundary", () => ({
  HostRouteBootstrapBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/screens/workspace/workspace-screen", () => ({ WorkspaceScreen: () => null }));
vi.mock("@/stores/session-store-hooks", () => ({
  useHasHydratedWorkspaces: () => true,
  useWorkspaceExists: () => true,
}));
vi.mock("@/stores/workspace-layout-store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useWorkspaceLayoutStoreHydrated: () => true,
}));

import HostWorkspaceIndexRoute from "@/app/h/[serverId]/workspace/[workspaceId]";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

const key = "intent-host:project:project";

afterEach(() => {
  cleanup();
  useSessionStore.getState().clearSession("intent-host");
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  vi.unstubAllGlobals();
  route.local.open = undefined;
});

it("ignores a parent's consumed agent intent while still handling the current page's intent", async () => {
  vi.stubGlobal("React", React);
  const session = useSessionStore.getState();
  session.initializeSession("intent-host", null as unknown as DaemonClient);
  session.setWorkspaces(
    "intent-host",
    new Map([
      [
        "new",
        {
          id: "new",
          projectId: "project",
          projectDisplayName: "Project",
          projectRootPath: "/repo",
          workspaceDirectory: "/repo",
          projectKind: "git",
          workspaceKind: "checkout",
          name: "New workspace",
          status: "done",
          statusEnteredAt: null,
          archivingAt: null,
          diffStat: null,
          scripts: [],
        } satisfies WorkspaceDescriptor,
      ],
    ]),
  );
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  const draftTabId = useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: key,
    target: { kind: "draft", draftId: "new-draft", workspaceId: "new" },
    intent: "new",
  });

  const mounted = render(<HostWorkspaceIndexRoute />);
  let layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[key]!;
  expect(
    collectAllTabs(layout.root)
      .filter((tab) => tab.target.kind !== "new_tab")
      .map((tab) => tab.target),
  ).toEqual([{ kind: "draft", draftId: "new-draft", workspaceId: "new" }]);
  expect(findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId).toBe(draftTabId);

  await act(async () => {
    route.local.open = "agent:current-agent";
    mounted.rerender(<HostWorkspaceIndexRoute />);
  });
  layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[key]!;
  expect(
    collectAllTabs(layout.root)
      .filter((tab) => tab.target.kind === "agent")
      .map((tab) => tab.target),
  ).toEqual([{ kind: "agent", agentId: "current-agent", workspaceId: "new" }]);
});

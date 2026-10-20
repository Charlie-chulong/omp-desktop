/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

const connection = vi.hoisted(() => ({
  statuses: new Map<string, HostRuntimeConnectionStatus>(),
  listeners: new Set<() => void>(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("@/runtime/host-runtime", () => {
  const hosts = [{ serverId: "host-a" }, { serverId: "host-b" }];
  return {
    getHostRuntimeStore: () => ({}),
    useHosts: () => hosts,
    useHostRegistryLoaded: () => true,
    useHostRuntimeConnectionStatuses: () =>
      useSyncExternalStore(
        (listener) => {
          connection.listeners.add(listener);
          return () => connection.listeners.delete(listener);
        },
        () => connection.statuses,
      ),
  };
});

import { useSessionStore } from "@/stores/session-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useSidebarWorkspacesList } from "./use-sidebar-workspaces-list";

function setStatus(serverId: string, status: HostRuntimeConnectionStatus) {
  act(() => {
    connection.statuses = new Map(connection.statuses).set(serverId, status);
    for (const notify of connection.listeners) notify();
  });
}

describe("sidebar projects on disconnected hosts", () => {
  beforeEach(() => {
    connection.statuses = new Map([
      ["host-a", "online"],
      ["host-b", "online"],
    ]);
    useSessionStore.setState({ sessions: {} });
    useSidebarOrderStore.setState({ projectOrder: [], workspaceOrderByProject: {} });
    useSidebarViewStore.setState({ hostFilters: [] });
    const store = useSessionStore.getState();
    for (const serverId of ["host-a", "host-b"]) {
      store.initializeSession(serverId, null);
      store.setProjects(serverId, [
        {
          projectId: serverId,
          projectKey: null,
          projectDisplayName: serverId,
          projectCustomName: null,
          projectRootPath: `/${serverId}`,
          projectKind: "git",
        },
      ]);
      store.mergeWorkspaces(serverId, [
        {
          id: "workspace",
          projectId: serverId,
          projectDisplayName: serverId,
          projectRootPath: `/${serverId}`,
          workspaceDirectory: `/${serverId}`,
          projectKind: "git",
          workspaceKind: "local_checkout",
          name: "main",
          status: "done",
          statusEnteredAt: null,
          archivingAt: null,
          diffStat: null,
          scripts: [],
        },
      ]);
      store.setHasHydratedWorkspaces(serverId, true);
    }
  });
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ sessions: {} });
    useSidebarOrderStore.setState({ projectOrder: [], workspaceOrderByProject: {} });
    useSidebarViewStore.setState({ hostFilters: [] });
  });

  it("hides cached projects and workspaces on disconnect and restores them on reconnect", () => {
    const { result } = renderHook(() => useSidebarWorkspacesList());
    expect(result.current.projects.map((p) => p.projectName)).toEqual(["host-a", "host-b"]);
    const order = useSidebarOrderStore.getState().projectOrder;
    setStatus("host-b", "offline");
    expect(result.current.projects.map((p) => p.projectName)).toEqual(["host-a"]);
    expect(result.current.workspacePlacements.map((w) => w.serverId)).toEqual(["host-a"]);
    expect(useSessionStore.getState().sessions["host-b"].projects.has("host-b")).toBe(true);
    expect(useSidebarOrderStore.getState().projectOrder).toEqual(order);
    setStatus("host-b", "online");
    expect(result.current.projects.map((p) => p.projectName)).toEqual(["host-a", "host-b"]);
    expect(result.current.workspacePlacements.map((w) => w.serverId)).toEqual(["host-a", "host-b"]);
  });

  it.each(["idle", "connecting", "offline", "error"] as const)(
    "keeps the selected host filter without falling back to other hosts when %s",
    (status) => {
      useSidebarViewStore.setState({ hostFilters: ["host-b"] });
      const { result } = renderHook(() => useSidebarWorkspacesList());
      setStatus("host-b", status);
      expect(result.current.projects).toEqual([]);
      expect(result.current.workspacePlacements).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-b"]);
      setStatus("host-b", "online");
      expect(result.current.projects.map((p) => p.projectName)).toEqual(["host-b"]);
    },
  );
});

/** @vitest-environment jsdom */
import type { DaemonClient } from "@omp-desktop/client/internal/daemon-client";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore, type ExplorerDirectory } from "@/stores/session-store";
import { useFileExplorerActions } from "./use-file-explorer-actions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SERVER_ID = "file-explorer-race-server";
const WORKSPACE_ID = "workspace-1";
const WORKSPACE_ROOT = "/repo";
const WORKSPACE_STATE_KEY = `workspace:${WORKSPACE_ID}`;
const MODIFIED_AT = "2026-10-20T00:00:00.000Z";

const staleRoot: ExplorerDirectory = {
  path: ".",
  entries: [
    {
      name: "stale.txt",
      path: "stale.txt",
      kind: "file",
      size: 5,
      modifiedAt: MODIFIED_AT,
    },
  ],
};
const freshRoot: ExplorerDirectory = {
  path: ".",
  entries: [
    {
      name: "fresh.txt",
      path: "fresh.txt",
      kind: "file",
      size: 5,
      modifiedAt: MODIFIED_AT,
    },
  ],
};
const srcDirectory: ExplorerDirectory = {
  path: "src",
  entries: [
    {
      name: "index.ts",
      path: "src/index.ts",
      kind: "file",
      size: 5,
      modifiedAt: MODIFIED_AT,
    },
  ],
};
const docsDirectory: ExplorerDirectory = {
  path: "docs",
  entries: [
    {
      name: "guide.md",
      path: "docs/guide.md",
      kind: "file",
      size: 5,
      modifiedAt: MODIFIED_AT,
    },
  ],
};

interface PendingDirectoryRequest {
  path: string;
  promise: Promise<ExplorerDirectory>;
  resolve(value: ExplorerDirectory | PromiseLike<ExplorerDirectory>): void;
  reject(reason?: unknown): void;
}

let pendingRequests: PendingDirectoryRequest[];

beforeEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
  pendingRequests = [];
  const listDirectory = vi.fn((_cwd: string, path: string) => {
    const pending = Promise.withResolvers<ExplorerDirectory>();
    pendingRequests.push({ path, ...pending });
    return pending.promise;
  });
  useSessionStore
    .getState()
    .initializeSession(SERVER_ID, { listDirectory } as unknown as DaemonClient);
});

afterEach(() => {
  cleanup();
  useSessionStore.getState().clearSession(SERVER_ID);
});

describe("useFileExplorerActions directory request ordering", () => {
  it("keeps the newer listing when an older request for the same directory resolves last", async () => {
    const { result } = renderHook(() =>
      useFileExplorerActions({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceRoot: WORKSPACE_ROOT,
      }),
    );
    let olderRequest!: Promise<ExplorerDirectory | null>;
    let newerRequest!: Promise<ExplorerDirectory | null>;

    act(() => {
      olderRequest = result.current.requestDirectoryListing(".");
      newerRequest = result.current.requestDirectoryListing(".");
    });
    expect(pendingRequests.map((request) => request.path)).toEqual([".", "."]);

    await act(async () => {
      pendingRequests[1]!.resolve(freshRoot);
      await newerRequest;
    });
    expect(
      useSessionStore
        .getState()
        .sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY)
        ?.directories.get(".")
        ?.entries.map((entry) => entry.name),
    ).toEqual(["fresh.txt"]);

    await act(async () => {
      pendingRequests[0]!.resolve(staleRoot);
      await olderRequest;
    });
    const explorer = useSessionStore
      .getState()
      .sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY);
    expect(explorer?.directories.get(".")?.entries.map((entry) => entry.name)).toEqual([
      "fresh.txt",
    ]);
    expect(explorer?.lastError).toBeNull();
  });

  it("does not let an older failure replace a newer successful listing", async () => {
    const { result } = renderHook(() =>
      useFileExplorerActions({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceRoot: WORKSPACE_ROOT,
      }),
    );
    let olderRequest!: Promise<ExplorerDirectory | null>;
    let newerRequest!: Promise<ExplorerDirectory | null>;

    act(() => {
      olderRequest = result.current.requestDirectoryListing(".");
      newerRequest = result.current.requestDirectoryListing(".");
    });
    await act(async () => {
      pendingRequests[1]!.resolve(freshRoot);
      await newerRequest;
    });
    await act(async () => {
      pendingRequests[0]!.reject(new Error("stale request failed"));
      await olderRequest;
    });

    const explorer = useSessionStore
      .getState()
      .sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY);
    expect(explorer?.directories.get(".")?.entries.map((entry) => entry.name)).toEqual([
      "fresh.txt",
    ]);
    expect(explorer?.lastError).toBeNull();
  });

  it("keeps a newer same-directory error visible when the older listing succeeds later", async () => {
    const { result } = renderHook(() =>
      useFileExplorerActions({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceRoot: WORKSPACE_ROOT,
      }),
    );
    let olderRequest!: Promise<ExplorerDirectory | null>;
    let newerRequest!: Promise<ExplorerDirectory | null>;

    act(() => {
      olderRequest = result.current.requestDirectoryListing(".");
      newerRequest = result.current.requestDirectoryListing(".");
    });
    await act(async () => {
      pendingRequests[1]!.reject(new Error("newest request failed"));
      await newerRequest;
    });
    expect(
      useSessionStore.getState().sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY)
        ?.lastError,
    ).toBe("newest request failed");

    await act(async () => {
      pendingRequests[0]!.resolve(staleRoot);
      await olderRequest;
    });
    const explorer = useSessionStore
      .getState()
      .sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY);
    expect(explorer?.directories.has(".")).toBe(false);
    expect(explorer?.lastError).toBe("newest request failed");
  });

  it("commits concurrent listings for different directories independently", async () => {
    const { result } = renderHook(() =>
      useFileExplorerActions({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceRoot: WORKSPACE_ROOT,
      }),
    );
    let srcRequest!: Promise<ExplorerDirectory | null>;
    let docsRequest!: Promise<ExplorerDirectory | null>;

    act(() => {
      srcRequest = result.current.requestDirectoryListing("src", {
        recordHistory: false,
        setCurrentPath: false,
      });
      docsRequest = result.current.requestDirectoryListing("docs", {
        recordHistory: false,
        setCurrentPath: false,
      });
    });
    await act(async () => {
      pendingRequests[1]!.resolve(docsDirectory);
      await docsRequest;
    });
    await act(async () => {
      pendingRequests[0]!.resolve(srcDirectory);
      await srcRequest;
    });

    const directories = useSessionStore
      .getState()
      .sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY)?.directories;
    expect(directories?.get("src")?.entries.map((entry) => entry.path)).toEqual(["src/index.ts"]);
    expect(directories?.get("docs")?.entries.map((entry) => entry.path)).toEqual(["docs/guide.md"]);
  });

  it("keeps a root refresh failure visible while a concurrent child listing succeeds", async () => {
    const { result } = renderHook(() =>
      useFileExplorerActions({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceRoot: WORKSPACE_ROOT,
      }),
    );
    let rootRequest!: Promise<ExplorerDirectory | null>;
    let srcRequest!: Promise<ExplorerDirectory | null>;
    act(() => {
      rootRequest = result.current.requestDirectoryListing(".");
      srcRequest = result.current.requestDirectoryListing("src", {
        recordHistory: false,
        setCurrentPath: false,
      });
    });
    await act(async () => {
      pendingRequests[0]!.reject(new Error("root listing failed"));
      await rootRequest;
    });
    const whileLoading = useSessionStore
      .getState()
      .sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY);
    expect(whileLoading?.lastError).toBe("root listing failed");
    expect(whileLoading?.isLoading).toBe(true);
    expect(whileLoading?.pendingRequest).toEqual({ path: "src", mode: "list" });

    await act(async () => {
      pendingRequests[1]!.resolve(srcDirectory);
      await srcRequest;
    });
    const explorer = useSessionStore
      .getState()
      .sessions[SERVER_ID]?.fileExplorer.get(WORKSPACE_STATE_KEY);
    expect(explorer?.directories.get("src")?.entries.map((entry) => entry.path)).toEqual([
      "src/index.ts",
    ]);
    expect(explorer?.lastError).toBe("root listing failed");
    expect(explorer?.isLoading).toBe(false);
  });
});

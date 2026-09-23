/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    borderRadius: { md: 6 },
    colors: {
      destructive: "#f44",
      foreground: "#fff",
      statusDotRunning: "#blue",
      statusSuccess: "#green",
      statusWarning: "#amber",
      statusDanger: "#red",
      foregroundMuted: "#aaa",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (value: typeof theme) => unknown)(theme)
        : factory,
  },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; name?: string }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    CircleAlert: icon("CircleAlert"),
    CircleCheck: icon("CircleCheck"),
    CircleDot: icon("CircleDot"),
    CircleHelp: icon("CircleHelp"),
    CircleMinus: icon("CircleMinus"),
    CircleX: icon("CircleX"),
    Square: icon("Square"),
    Terminal: icon("Terminal"),
  };
});

vi.mock("@/composer/tracks", () => ({
  ComposerTrackPill: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  ComposerTrackRow: ({ children, testID }: { children: React.ReactNode; testID: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { BackgroundProcessesTrack } from "./track";

const process = {
  id: "omp-job:job-1",
  scope: "agent" as const,
  source: "omp-job" as const,
  name: "npm run dev",
  command: "npm run dev",
  cwd: "/repo",
  status: "running" as const,
  ownerAgentId: null,
  startedAt: 1,
  endedAt: null,
  exitCode: null,
  terminalId: null,
};

describe("BackgroundProcessesTrack", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows a running process and stops it without opening output", async () => {
    const stopProcess = vi.fn(async () => undefined);
    const onOpen = vi.fn();
    const state = {
      processes: [process],
      error: null,
      stopError: null,
      isConnected: true,
      isLoading: false,
      stoppingProcessIds: new Set<string>(),
      stopProcess,
    };

    await act(async () => {
      root.render(React.createElement(BackgroundProcessesTrack, { state, onOpen }));
    });

    expect(container.textContent).toContain("npm run dev");
    const stop = container.querySelector<HTMLElement>(
      '[data-testid="background-process-stop-omp-job:job-1"]',
    );
    expect(stop).not.toBeNull();
    expect(stop?.textContent).toBe("");
    expect(container.querySelector('[data-icon="CircleDot"]')).not.toBeNull();
    expect(container.textContent).not.toContain("backgroundProcesses.status.running");

    await act(async () => stop?.click());

    expect(stopProcess).toHaveBeenCalledWith("omp-job:job-1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("hides the indicator when no process is active, but keeps errors visible", async () => {
    const state = {
      processes: [{ ...process, status: "exited" as const, exitCode: 0 }],
      error: null as string | null,
      stopError: null,
      isConnected: true,
      isLoading: false,
      stoppingProcessIds: new Set<string>(),
      stopProcess: vi.fn(async () => undefined),
    };
    const onOpen = vi.fn();
    await act(async () => {
      root.render(React.createElement(BackgroundProcessesTrack, { state, onOpen }));
    });
    expect(container.textContent).toBe("");

    await act(async () => {
      root.render(
        React.createElement(BackgroundProcessesTrack, {
          state: { ...state, error: "Host disconnected" },
          onOpen,
        }),
      );
    });
    expect(container.textContent).toContain("Host disconnected");
  });

  it("places active processes first within each scope without reordering peers", async () => {
    const state = {
      processes: [
        { ...process, id: "exited", status: "exited" as const },
        { ...process, id: "running" },
        { ...process, id: "failed", status: "failed" as const },
        { ...process, id: "starting", status: "starting" as const },
        {
          ...process,
          id: "workspace-exited",
          scope: "workspace" as const,
          status: "exited" as const,
        },
        {
          ...process,
          id: "workspace-ready",
          scope: "workspace" as const,
          status: "ready" as const,
        },
      ],
      error: null,
      stopError: null,
      isConnected: true,
      isLoading: false,
      stoppingProcessIds: new Set<string>(),
      stopProcess: vi.fn(async () => undefined),
    };

    await act(async () => {
      root.render(React.createElement(BackgroundProcessesTrack, { state, onOpen: vi.fn() }));
    });

    expect(
      Array.from(container.querySelectorAll('[data-testid^="background-process-"]'))
        .filter((row) => !row.getAttribute("data-testid")?.startsWith("background-process-stop-"))
        .map((row) => row.getAttribute("data-testid")),
    ).toEqual([
      "background-process-running",
      "background-process-starting",
      "background-process-exited",
      "background-process-failed",
      "background-process-workspace-ready",
      "background-process-workspace-exited",
    ]);
    expect(state.processes[0]?.id).toBe("exited");
  });

  it("shows success and failure statuses without shifting the action rail", async () => {
    const state = {
      processes: [
        { ...process, id: "ready", status: "ready" as const },
        { ...process, id: "failed", status: "exited" as const, exitCode: 1 },
      ],
      error: null,
      stopError: null,
      isConnected: true,
      isLoading: false,
      stoppingProcessIds: new Set<string>(),
      stopProcess: vi.fn(async () => undefined),
    };
    await act(async () => {
      root.render(React.createElement(BackgroundProcessesTrack, { state, onOpen: vi.fn() }));
    });
    const ready = container.querySelector('[data-testid="background-process-ready"]');
    const failed = container.querySelector('[data-testid="background-process-failed"]');
    expect(ready?.querySelector('[data-icon="CircleCheck"]')).not.toBeNull();
    expect(failed?.querySelector('[data-icon="CircleX"]')).not.toBeNull();
    expect(ready?.querySelector('[aria-label="backgroundProcesses.status.ready"]')).not.toBeNull();
    expect(failed?.querySelector('[data-testid="background-process-stop-failed"]')).toBeNull();
  });
});

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

vi.mock("lucide-react-native", () => ({
  Square: (props: Record<string, unknown>) => React.createElement("span", props),
  Terminal: (props: Record<string, unknown>) => React.createElement("span", props),
}));

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

    await act(async () => stop?.click());

    expect(stopProcess).toHaveBeenCalledWith("omp-job:job-1");
    expect(onOpen).not.toHaveBeenCalled();
  });
});

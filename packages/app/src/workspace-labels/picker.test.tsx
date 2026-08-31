/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as MenuModule from "@/components/ui/menu";
import type * as WorkspaceLabelsModule from "@/workspace-labels";
import { MenuRoot } from "@/components/ui/menu";
import type { useWorkspaceLabelMenuPages as UseWorkspaceLabelMenuPages } from "./picker";
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  useUnistyles: () => ({ rt: { breakpoint: "md" } }),
  withUnistyles: (Component: React.ComponentType) => Component,
}));

vi.mock("@/components/ui/menu", async (importOriginal) => {
  const actual = await importOriginal<typeof MenuModule>();
  return { ...actual, MenuSubTrigger: () => null };
});

const mocks = vi.hoisted(() => ({
  setAssignment: vi.fn(async () => undefined),
  inspectDelete: vi.fn(async () => ({ affectedWorkspaceCount: 1 })),
  deleteLabel: vi.fn(async () => undefined),
  confirmDialog: vi.fn(async () => true),
  projection: {
    labels: [{ name: "Work", color: "purple" }],
    targetHost: { status: "online" },
  },
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: mocks.confirmDialog,
}));

vi.mock("@/workspace-labels", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceLabelsModule>();
  return {
    ...actual,
    useWorkspaceLabelProjection: () => mocks.projection,
    workspaceLabels: {
      setAssignment: mocks.setAssignment,
      inspectDelete: mocks.inspectDelete,
      delete: mocks.deleteLabel,
    },
  };
});

let useWorkspaceLabelMenuPages: typeof UseWorkspaceLabelMenuPages;

beforeAll(async () => {
  vi.stubGlobal("React", React);
  // The picker has module-level JSX, so load it only after installing React's test global.
  ({ useWorkspaceLabelMenuPages } = await import("./picker"));
});

function LabelPicker() {
  const pages = useWorkspaceLabelMenuPages({
    serverId: "host-1",
    workspaceId: "workspace-1",
    labels: ["Work"],
  });
  return <MenuRoot>{pages[0]?.content}</MenuRoot>;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  mocks.inspectDelete.mockResolvedValue({ affectedWorkspaceCount: 1 });
  mocks.confirmDialog.mockResolvedValue(true);
});

describe("workspace label picker", () => {
  it("deletes a label without toggling its workspace assignment", async () => {
    const { getByTestId } = render(<LabelPicker />);

    fireEvent.click(getByTestId("workspace-label-picker-delete-Work"));

    await waitFor(() => {
      expect(mocks.inspectDelete).toHaveBeenCalledWith({ serverId: "host-1", name: "Work" });
      expect(mocks.confirmDialog).toHaveBeenCalled();
      expect(mocks.deleteLabel).toHaveBeenCalledWith({ serverId: "host-1", name: "Work" });
    });
    expect(mocks.setAssignment).not.toHaveBeenCalled();
  });
});

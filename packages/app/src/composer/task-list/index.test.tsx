/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

vi.mock("react-native", () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", props, children),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    ...props
  }: React.PropsWithChildren<{
    onPress?: () => void;
    accessibilityLabel?: string;
  }>) =>
    React.createElement(
      "button",
      { ...props, "aria-label": accessibilityLabel, onClick: onPress },
      children,
    ),
  ScrollView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", props, children),
  Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("span", props, children),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (theme: Record<string, unknown>) => unknown) =>
      factory({
        spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
        colors: { surface1: "#111", border: "#222", foreground: "#fff", foregroundMuted: "#aaa" },
        borderWidth: { 1: 1 },
        borderRadius: { md: 6, lg: 8, xl: 12 },
        fontSize: { sm: 12, base: 14 },
        fontWeight: { semibold: "600" },
      }),
  },
  useUnistyles: () => ({
    theme: {
      colors: { foregroundMuted: "#aaa" },
    },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { completed?: number; total?: number }) => {
      if (key === "message.todo.tasksProgress") {
        return `${values?.completed}/${values?.total} tasks`;
      }
      if (key === "message.todo.collapse") return "Collapse tasks";
      if (key === "message.todo.expand") return "Show tasks";
      return "Tasks";
    },
  }),
}));
vi.mock("lucide-react-native", () => ({
  ListTodo: () => <span>list</span>,
  PanelRightClose: () => <span>collapse</span>,
}));
vi.mock("@/components/task-list-row", () => ({
  TaskListRow: ({ task }: { task: { text: string } }) => <span>{task.text}</span>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren) => (
    <div data-testid="task-tooltip">{children}</div>
  ),
}));

import { AgentTaskPanel, AgentTaskPanelToggle } from "./index";

describe("AgentTaskPanel", () => {
  afterEach(cleanup);

  it("renders current tasks expanded with a collapse action", () => {
    const onCollapse = vi.fn();
    const view = render(
      <AgentTaskPanel
        onCollapse={onCollapse}
        tasks={[
          { text: "Inspect", completed: true, status: "completed" },
          {
            text: "Implement",
            activeForm: "Implementing the complete task description",
            completed: false,
            status: "in_progress",
          },
        ]}
      />,
    );

    expect(view.getByText("1/2 tasks")).toBeTruthy();
    expect(view.getAllByText("Inspect")).toHaveLength(2);
    expect(view.getByText("Implement")).toBeTruthy();
    expect(view.getByText("Implementing the complete task description")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Collapse tasks" }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it("renders progress in the compact entry point and restores the task panel", () => {
    const onExpand = vi.fn();
    const view = render(
      <AgentTaskPanelToggle
        tasks={[
          { text: "Done", completed: true, status: "completed" },
          { text: "Next", completed: false, status: "pending" },
        ]}
        onExpand={onExpand}
      />,
    );

    expect(view.getByText("1/2 tasks")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Show tasks: 1/2 tasks" }));
    expect(onExpand).toHaveBeenCalledOnce();
  });
});

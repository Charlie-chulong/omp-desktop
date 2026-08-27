import { memo, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ListTodo, PanelRightClose } from "lucide-react-native";
import { TaskListRow } from "@/components/task-list-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TodoEntry } from "@/types/stream";

export const AGENT_TASK_PANEL_DESKTOP_WIDTH = 340;

export const AgentTaskPanel = memo(function AgentTaskPanel({
  tasks,
  onCollapse,
}: {
  tasks: TodoEntry[] | undefined;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const completed = useMemo(
    () => tasks?.filter((task) => task.completed || task.status === "completed").length ?? 0,
    [tasks],
  );
  if (!tasks?.length) return null;

  return (
    <View style={styles.panel} testID="agent-task-panel">
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{t("message.todo.title")}</Text>
        <View style={styles.panelHeaderActions}>
          <Text style={styles.panelProgress}>
            {t("message.todo.tasksProgress", { completed, total: tasks.length })}
          </Text>
          <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Pressable
                onPress={onCollapse}
                accessibilityRole="button"
                accessibilityLabel={t("message.todo.collapse")}
                style={styles.iconButton}
                testID="agent-task-panel-collapse"
              >
                <PanelRightClose size={16} color={theme.colors.foregroundMuted} />
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="left" align="center" offset={8}>
              <Text style={styles.tooltipText}>{t("message.todo.collapse")}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      </View>
      <ScrollView
        style={styles.panelScroll}
        contentContainerStyle={styles.panelList}
        showsVerticalScrollIndicator
      >
        {tasks.map((task, index) => {
          const completed = task.completed || task.status === "completed";
          const displayText =
            !completed && task.status === "in_progress" && task.activeForm
              ? task.activeForm
              : task.text;
          return (
            <Tooltip
              key={task.id ?? `${index}:${task.text}`}
              delayDuration={250}
              enabledOnDesktop
              enabledOnMobile={false}
            >
              <TooltipTrigger asChild>
                <View style={styles.panelRow} collapsable={false}>
                  <TaskListRow task={task} />
                </View>
              </TooltipTrigger>
              <TooltipContent side="left" align="center" offset={10}>
                <Text style={styles.tooltipText}>{displayText}</Text>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </ScrollView>
    </View>
  );
});

export const AgentTaskPanelToggle = memo(function AgentTaskPanelToggle({
  tasks,
  onExpand,
}: {
  tasks: TodoEntry[];
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const completed = useMemo(
    () => tasks.filter((task) => task.completed || task.status === "completed").length,
    [tasks],
  );
  const progress = t("message.todo.tasksProgress", { completed, total: tasks.length });
  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityLabel={`${t("message.todo.expand")}: ${progress}`}
          style={styles.collapsedButton}
          testID="agent-task-panel-expand"
        >
          <ListTodo size={18} color={theme.colors.foregroundMuted} />
          <Text style={styles.collapsedProgress}>{progress}</Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="left" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("message.todo.expand")}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  panel: {
    width: { xs: 280, md: AGENT_TASK_PANEL_DESKTOP_WIDTH },
    maxHeight: 560,
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    gap: theme.spacing[3],
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  panelHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  collapsedButton: {
    minHeight: 34,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  collapsedProgress: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  panelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  panelProgress: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  panelScroll: {
    flexShrink: 1,
  },
  panelList: {
    gap: theme.spacing[1],
    paddingRight: theme.spacing[1],
  },
  panelRow: {
    minWidth: 0,
    paddingVertical: theme.spacing[2],
  },
  tooltipText: {
    maxWidth: 420,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
}));

import { Check, Clock3, Pause, Pencil, Play, Target, Trash2, X } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { StreamItem } from "@/types/stream";
import { formatDuration } from "@/utils/time";

export interface GoalSnapshot {
  objective: string;
  status: string | null;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string | null;
  updatedAt: string | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function goalMetadata(item: StreamItem): Record<string, unknown> | null {
  if (item.kind !== "tool_call" || item.payload.source !== "agent") return null;
  const metadata = item.payload.data.metadata;
  return metadata?.source === "omp_goal_updated" ? metadata : null;
}

export function findLatestGoalSnapshot(
  tail: readonly StreamItem[],
  head: readonly StreamItem[],
): GoalSnapshot | null {
  let latestItem: StreamItem | null = null;
  let latestMetadata: Record<string, unknown> | null = null;
  for (const items of [tail, head]) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item) continue;
      const metadata = goalMetadata(item);
      if (!metadata) continue;
      if (!latestItem || item.timestamp.getTime() > latestItem.timestamp.getTime()) {
        latestItem = item;
        latestMetadata = metadata;
      }
      break;
    }
  }
  if (!latestMetadata) return null;

  const objective =
    typeof latestMetadata.goalObjective === "string" ? latestMetadata.goalObjective.trim() : "";
  const status = typeof latestMetadata.goalStatus === "string" ? latestMetadata.goalStatus : null;
  if (!objective && !status && typeof latestMetadata.goalId !== "string") return null;

  return {
    objective,
    status,
    tokenBudget: finiteNumber(latestMetadata.goalTokenBudget),
    tokensUsed: finiteNumber(latestMetadata.goalTokensUsed) ?? 0,
    timeUsedSeconds: finiteNumber(latestMetadata.goalTimeUsedSeconds) ?? 0,
    createdAt:
      typeof latestMetadata.goalCreatedAt === "string" ? latestMetadata.goalCreatedAt : null,
    updatedAt:
      typeof latestMetadata.goalUpdatedAt === "string" ? latestMetadata.goalUpdatedAt : null,
  };
}

function resolveElapsedMs(goal: GoalSnapshot | null, nowMs: number): number {
  if (!goal) return 0;
  const reportedMs = goal.timeUsedSeconds * 1000;
  if (goal.status !== "active") return reportedMs;
  const updatedAtMs = goal.updatedAt ? Date.parse(goal.updatedAt) : Number.NaN;
  if (Number.isFinite(updatedAtMs)) return reportedMs + Math.max(0, nowMs - updatedAtMs);
  const createdAtMs = goal.createdAt ? Date.parse(goal.createdAt) : Number.NaN;
  return Number.isFinite(createdAtMs) ? Math.max(reportedMs, nowMs - createdAtMs) : reportedMs;
}

export type GoalControlAction = "start" | "pause" | "delete";

export const GoalBar = memo(function GoalBar({
  goal,
  initialObjective = "",
  disabled,
  onSave,
  onAction,
}: {
  goal: GoalSnapshot | null;
  initialObjective?: string;
  disabled: boolean;
  onSave: (objective: string) => Promise<void>;
  onAction: (action: GoalControlAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const initialValue = goal?.objective || initialObjective;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [draft, setDraft] = useState(initialValue);
  const [savedObjective, setSavedObjective] = useState(initialValue);
  const [optimisticStatus, setOptimisticStatus] = useState<"active" | "paused" | null>(null);
  const [optimisticElapsedMs, setOptimisticElapsedMs] = useState(0);
  const [optimisticStartedAtMs, setOptimisticStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const objective = goal?.objective || initialObjective;
    if (objective) setSavedObjective(objective);
  }, [goal?.objective, initialObjective]);

  useEffect(() => {
    setOptimisticStatus(null);
    setOptimisticStartedAtMs(null);
  }, [goal?.status, goal?.timeUsedSeconds, goal?.updatedAt]);

  const currentObjective = goal?.objective || savedObjective;
  useEffect(() => {
    if (!editing) setDraft(currentObjective);
  }, [currentObjective, editing]);

  const authoritativeElapsedMs = resolveElapsedMs(goal, nowMs);
  const isActive = optimisticStatus ? optimisticStatus === "active" : goal?.status === "active";
  const elapsedMs =
    optimisticStatus === null
      ? authoritativeElapsedMs
      : optimisticElapsedMs +
        (optimisticStatus === "active" && optimisticStartedAtMs !== null
          ? Math.max(0, nowMs - optimisticStartedAtMs)
          : 0);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const beginEditing = useCallback(() => {
    if (!disabled && !controlling) setEditing(true);
  }, [controlling, disabled]);
  const cancelEditing = useCallback(() => {
    setDraft(currentObjective);
    setEditing(false);
  }, [currentObjective]);
  const save = useCallback(async () => {
    const objective = draft.trim();
    if (!objective || saving || disabled) return;
    setSaving(true);
    try {
      await onSave(objective);
      setSavedObjective(objective);
      setEditing(false);
    } catch {
      // The host owns error presentation; keep the editor open for retry.
    } finally {
      setSaving(false);
    }
  }, [disabled, draft, onSave, saving]);
  const saveFromInput = useCallback(() => void save(), [save]);

  const toggleRunning = useCallback(async () => {
    if (disabled || controlling) return;
    if (!currentObjective) {
      setEditing(true);
      return;
    }
    const action: GoalControlAction = isActive ? "pause" : "start";
    const elapsedAtAction = elapsedMs;
    setControlling(true);
    try {
      await onAction(action);
      const actionAt = Date.now();
      setNowMs(actionAt);
      setOptimisticElapsedMs(elapsedAtAction);
      setOptimisticStartedAtMs(action === "start" ? actionAt : null);
      setOptimisticStatus(action === "start" ? "active" : "paused");
    } finally {
      setControlling(false);
    }
  }, [controlling, currentObjective, disabled, elapsedMs, isActive, onAction]);
  const toggleRunningFromPress = useCallback(
    () => void toggleRunning().catch(() => undefined),
    [toggleRunning],
  );

  const deleteGoal = useCallback(async () => {
    if (disabled || controlling) return;
    setControlling(true);
    try {
      await onAction("delete");
      setSavedObjective("");
      setDraft("");
      setOptimisticElapsedMs(0);
      setOptimisticStartedAtMs(null);
      setOptimisticStatus("paused");
      setEditing(false);
    } finally {
      setControlling(false);
    }
  }, [controlling, disabled, onAction]);
  const deleteGoalFromPress = useCallback(
    () => void deleteGoal().catch(() => undefined),
    [deleteGoal],
  );

  const elapsed = formatDuration(elapsedMs);
  const tokenLabel = useMemo(() => {
    const used = formatTokenCount(goal?.tokensUsed ?? 0);
    return goal?.tokenBudget == null
      ? `${used} tokens`
      : `${used} / ${formatTokenCount(goal.tokenBudget)} tokens`;
  }, [goal?.tokenBudget, goal?.tokensUsed]);

  return (
    <View style={styles.rail} testID="agent-goal-bar">
      <View style={styles.bar}>
        <Target size={16} color={theme.colors.accent} />
        <View style={styles.objectiveArea}>
          {editing ? (
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={saveFromInput}
              editable={!saving && !disabled}
              placeholder={t("agentControls.features.workflow.goalPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
              returnKeyType="done"
              testID="agent-goal-objective-input"
            />
          ) : (
            <Pressable onPress={beginEditing} disabled={disabled} style={styles.objectiveButton}>
              <Text
                numberOfLines={1}
                style={currentObjective ? styles.objective : styles.placeholder}
              >
                {currentObjective || t("agentControls.features.workflow.goalPlaceholder")}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={styles.stat}>
          <Clock3 size={13} color={theme.colors.foregroundMuted} />
          <Text style={styles.statText}>{elapsed}</Text>
        </View>
        <Text style={styles.statText}>{tokenLabel}</Text>
        {editing ? (
          <View style={styles.actions}>
            <Pressable
              onPress={cancelEditing}
              disabled={saving}
              accessibilityLabel="Cancel goal edit"
              style={styles.iconButton}
            >
              <X size={15} color={theme.colors.foregroundMuted} />
            </Pressable>
            <Pressable
              onPress={saveFromInput}
              disabled={saving || disabled || !draft.trim()}
              accessibilityLabel="Save goal"
              style={styles.iconButton}
              testID="agent-goal-save"
            >
              <Check size={15} color={theme.colors.accent} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={beginEditing}
            disabled={disabled || controlling}
            accessibilityLabel="Edit goal"
            style={styles.iconButton}
            testID="agent-goal-edit"
          >
            <Pencil size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        )}
        <Pressable
          onPress={toggleRunningFromPress}
          disabled={disabled || controlling}
          accessibilityLabel={isActive ? "Pause goal" : "Start goal"}
          style={styles.iconButton}
          testID="agent-goal-toggle"
        >
          {isActive ? (
            <Pause size={15} color={theme.colors.accent} />
          ) : (
            <Play size={15} color={theme.colors.accent} />
          )}
        </Pressable>
        <Pressable
          onPress={deleteGoalFromPress}
          disabled={disabled || controlling}
          accessibilityLabel="Delete goal"
          style={styles.iconButton}
          testID="agent-goal-delete"
        >
          <Trash2 size={15} color={theme.colors.destructive} />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  rail: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[2],
    alignItems: "center",
  },
  bar: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    minHeight: 42,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  objectiveArea: {
    flex: 1,
    minWidth: 0,
  },
  objectiveButton: {
    minWidth: 0,
  },
  objective: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    padding: 0,
    minWidth: 0,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  statText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
}));

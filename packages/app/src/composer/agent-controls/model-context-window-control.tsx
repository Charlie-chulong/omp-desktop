import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react-native";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { useOmpModelContextWindow } from "@/hooks/use-omp-model-context-window";

interface ModelContextWindowControlProps {
  serverId: string | null;
  provider: string;
  modelId: string;
  catalogContextWindowMaxTokens?: number;
  enabled: boolean;
  disabled?: boolean;
  compact?: boolean;
}

function parseContextWindow(value: string): number | null {
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function ModelContextWindowControl({
  serverId,
  provider,
  modelId,
  catalogContextWindowMaxTokens,
  enabled,
  disabled = false,
  compact = false,
}: ModelContextWindowControlProps) {
  const { t } = useTranslation();
  const contextWindow = useOmpModelContextWindow({ serverId, provider, modelId, enabled });
  const effectiveContextWindow =
    contextWindow.contextWindowOverride ??
    contextWindow.reportedContextWindow ??
    catalogContextWindowMaxTokens;
  const initialValue = contextWindow.contextWindowOverride?.toString() ?? "";
  const resetKey = `${provider}:${modelId}:${initialValue}`;
  const [draftValue, setDraftValue] = useState(initialValue);
  const [editing, setEditing] = useState(false);
  const parsedDraft = useMemo(() => parseContextWindow(draftValue), [draftValue]);
  const normalizedDraft = draftValue.trim();
  const isInvalid = normalizedDraft.length > 0 && parsedDraft === null;
  const hasChanged = normalizedDraft !== initialValue;

  useEffect(() => {
    setDraftValue(initialValue);
    setEditing(false);
  }, [initialValue, modelId, provider]);

  const startEditing = useCallback(() => {
    setEditing(true);
  }, []);
  const cancelEditing = useCallback(() => {
    setDraftValue(initialValue);
    setEditing(false);
  }, [initialValue]);
  const saveOverride = useCallback(() => {
    if (parsedDraft === null) return;
    void contextWindow
      .save(parsedDraft)
      .then(() => setEditing(false))
      .catch(() => undefined);
  }, [contextWindow, parsedDraft]);
  const resetOverride = useCallback(() => {
    void contextWindow
      .save(null)
      .then(() => setEditing(false))
      .catch(() => undefined);
  }, [contextWindow]);

  const effectiveLabel = effectiveContextWindow
    ? formatTokenCount(effectiveContextWindow)
    : t("modelSelector.contextWindowUnknown");
  const controlsDisabled = disabled || contextWindow.isSaving;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={styles.summaryRow}>
        <View style={styles.contextGlyph}>
          <Text style={styles.contextGlyphText}>T</Text>
        </View>
        <Text style={styles.label}>{t("contextWindow.title")}</Text>
        <View style={styles.summaryActions}>
          <Text style={styles.effectiveValue}>{effectiveLabel}</Text>
          {contextWindow.canEdit && !editing ? (
            <Button
              size="xs"
              variant="ghost"
              leftIcon={Pencil}
              disabled={controlsDisabled}
              onPress={startEditing}
              testID="model-settings-context-window-edit"
            >
              {t("modelSelector.contextWindowEdit")}
            </Button>
          ) : null}
        </View>
      </View>
      {contextWindow.canEdit && editing ? (
        <View style={styles.editor}>
          <AdaptiveTextInput
            resetKey={resetKey}
            initialValue={initialValue}
            onChangeText={setDraftValue}
            placeholder={t("modelSelector.contextWindowUseDefault")}
            keyboardType="number-pad"
            inputMode="numeric"
            editable={!controlsDisabled}
            accessibilityLabel={t("modelSelector.contextWindowInputAccessibility")}
            style={styles.input}
          />
          <Text style={[styles.hint, isInvalid && styles.error]}>
            {isInvalid
              ? t("modelSelector.contextWindowInvalid")
              : contextWindow.error instanceof Error
                ? contextWindow.error.message
                : t("modelSelector.contextWindowHint")}
          </Text>
          <View style={styles.editorActions}>
            {contextWindow.contextWindowOverride ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={controlsDisabled}
                loading={contextWindow.isSaving && normalizedDraft.length === 0}
                onPress={resetOverride}
              >
                {t("modelSelector.contextWindowReset")}
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" disabled={controlsDisabled} onPress={cancelEditing}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              size="xs"
              variant="secondary"
              disabled={controlsDisabled || isInvalid || !hasChanged || parsedDraft === null}
              loading={contextWindow.isSaving && normalizedDraft.length > 0}
              onPress={saveOverride}
            >
              {t("modelSelector.contextWindowSave")}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[1],
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  containerCompact: {
    borderRadius: theme.borderRadius.lg,
  },
  summaryRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  summaryActions: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  contextGlyph: {
    width: 16,
    height: 16,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    borderRadius: theme.borderRadius.sm,
  },
  contextGlyphText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: theme.fontWeight.medium,
  },
  label: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
  },
  effectiveValue: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  editor: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  input: {
    minWidth: 0,
    height: 30,
    paddingHorizontal: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: 11,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  editorActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  error: {
    color: theme.colors.destructive,
  },
}));

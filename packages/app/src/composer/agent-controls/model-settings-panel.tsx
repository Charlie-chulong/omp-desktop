import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { AgentSelectOption } from "@omp-desktop/protocol/agent-types";
import { ThinkingIcon } from "@/agent-controls/icons";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { FAST_MODE_FEATURE_ID } from "@/agent-controls/policy";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import type { FastModeFeature } from "@/composer/agent-controls/utils";

interface ModelSettingsPanelProps {
  thinkingOptions: AgentSelectOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  fastMode: FastModeFeature | null;
  onSetFeature?: (featureId: string, value: unknown) => void;
  contextWindowMaxTokens?: number;
  contextControl?: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  compact?: boolean;
}

export function ModelSettingsPanel({
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  fastMode,
  onSetFeature,
  contextWindowMaxTokens,
  contextControl,
  disabled = false,
  pending = false,
  compact = false,
}: ModelSettingsPanelProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const thinkingAnchorRef = useRef<View>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const thinkingComboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      thinkingOptions.map((option) => ({
        id: option.id,
        label: formatThinkingOptionLabel(option),
        description: option.description,
      })),
    [thinkingOptions],
  );
  const selectedThinking =
    thinkingComboboxOptions.find((option) => option.id === selectedThinkingOptionId) ??
    thinkingComboboxOptions[0] ??
    null;
  const controlsDisabled = disabled || pending;
  const hasThinking = thinkingComboboxOptions.length > 1 && Boolean(onSelectThinkingOption);
  const hasContext = contextControl != null || contextWindowMaxTokens !== undefined;
  const hasControls = hasThinking || fastMode !== null || hasContext;

  const handleThinkingPress = useCallback(() => {
    setThinkingOpen((current) => !current);
  }, []);
  const handleThinkingSelect = useCallback(
    (id: string) => {
      onSelectThinkingOption?.(id);
      setThinkingOpen(false);
    },
    [onSelectThinkingOption],
  );
  const handleFastModeChange = useCallback(
    (value: boolean) => {
      if (fastMode) onSetFeature?.(fastMode.id, value);
    },
    [fastMode, onSetFeature],
  );
  const renderThinkingOption = useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => (
      <ComboboxItem
        label={args.option.label}
        description={args.option.description}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
        leadingSlot={<ThinkingIcon size={16} color={theme.colors.foreground} />}
      />
    ),
    [theme.colors.foreground],
  );

  if (!hasControls) return null;

  return (
    <View
      style={[styles.container, compact && styles.containerCompact]}
      testID="model-settings-panel"
    >
      <Text style={styles.heading}>{t("modelSelector.modelSettings")}</Text>
      <View style={styles.controls}>
        {hasThinking ? (
          <>
            <AgentControlTrigger
              ref={thinkingAnchorRef}
              icon={ThinkingIcon}
              surface="sheet"
              label={t("agentControls.thinking.title")}
              value={selectedThinking?.label ?? t("agentControls.thinking.unknown")}
              open={thinkingOpen}
              disabled={controlsDisabled}
              onPress={handleThinkingPress}
              accessibilityLabel={t("agentControls.thinking.selectWithValue", {
                value: selectedThinking?.label ?? t("agentControls.thinking.unknown"),
              })}
              testID="model-settings-thinking"
            />
            <Combobox
              options={thinkingComboboxOptions}
              value={selectedThinking?.id ?? ""}
              onSelect={handleThinkingSelect}
              open={thinkingOpen}
              onOpenChange={setThinkingOpen}
              anchorRef={thinkingAnchorRef}
              presentation={compact ? "push" : undefined}
              title={t("agentControls.thinking.title")}
              searchable={thinkingComboboxOptions.length > 6}
              renderOption={renderThinkingOption}
            />
          </>
        ) : null}
        {fastMode ? (
          <View style={[styles.settingRow, controlsDisabled && styles.disabled]}>
            <View style={styles.settingGlyph}>
              <Zap
                size={15}
                color={
                  fastMode.value ? theme.colors.palette.yellow[400] : theme.colors.foregroundMuted
                }
              />
            </View>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>{t("shell.commandCenter.fastModeGroupLabel")}</Text>
              {fastMode.description ? (
                <Text style={styles.settingDescription} numberOfLines={1}>
                  {fastMode.description}
                </Text>
              ) : null}
            </View>
            <Switch
              value={fastMode.value}
              onValueChange={handleFastModeChange}
              disabled={controlsDisabled || !onSetFeature}
              accessibilityLabel={t("shell.commandCenter.fastModeGroupLabel")}
              testID="model-settings-fast-mode"
            />
          </View>
        ) : null}
        {contextControl ??
          (contextWindowMaxTokens !== undefined ? (
            <View style={styles.settingRow} testID="model-settings-context-window">
              <View style={styles.contextGlyph}>
                <Text style={styles.contextGlyphText}>T</Text>
              </View>
              <Text style={styles.settingLabel}>{t("contextWindow.title")}</Text>
              <Text style={styles.settingValue}>{formatTokenCount(contextWindowMaxTokens)}</Text>
            </View>
          ) : null)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
  },
  containerCompact: {
    marginHorizontal: 0,
    borderRadius: theme.borderRadius.lg,
    borderTopWidth: 0,
    paddingHorizontal: 0,
    backgroundColor: "transparent",
  },
  heading: {
    paddingHorizontal: 2,
    paddingBottom: 2,
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  controls: {
    gap: 2,
  },
  settingRow: {
    minHeight: 36,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  settingGlyph: {
    width: 16,
    height: 16,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  contextGlyph: {
    width: 18,
    height: 18,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    borderRadius: theme.borderRadius.sm,
  },
  contextGlyphText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  settingText: {
    flex: 1,
    minWidth: 0,
  },
  settingLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
  },
  settingDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  settingValue: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  disabled: {
    opacity: 0.5,
  },
}));

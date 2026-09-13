import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@omp-desktop/protocol/agent-types";
import type { MutableDaemonConfig } from "@omp-desktop/protocol/messages";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

type SelectionMode = "automatic" | "preferred";
type ConfiguredProviders = MutableDaemonConfig["metadataGeneration"]["providers"];

interface ModelSelectionCardProps {
  id: string;
  title: string;
  hint: string;
  automaticHint: string;
  configuredProviders: ConfiguredProviders;
  providers: ProviderSelectorProvider[];
  isLoading: boolean;
  isRefreshing: boolean;
  onOpen: (provider?: AgentProvider) => void;
  onRefresh: (provider: AgentProvider) => void;
  onSave: (providers: ConfiguredProviders) => Promise<unknown>;
}

function ModelSelectionCard({
  id,
  title,
  hint,
  automaticHint,
  configuredProviders,
  providers,
  isLoading,
  isRefreshing,
  onOpen,
  onRefresh,
  onSave,
}: ModelSelectionCardProps) {
  const { t } = useTranslation();
  const configuredProvider = configuredProviders[0] ?? null;
  const savedMode: SelectionMode = configuredProvider ? "preferred" : "automatic";
  const [draftMode, setDraftMode] = useState<SelectionMode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mode = draftMode ?? savedMode;

  useEffect(() => {
    setDraftMode(null);
  }, [configuredProvider?.model, configuredProvider?.provider]);

  const modeOptions = useMemo(
    () => [
      { value: "automatic" as const, label: t("settings.metadataGeneration.automatic") },
      { value: "preferred" as const, label: t("settings.metadataGeneration.preferred") },
    ],
    [t],
  );

  const saveProviders = useCallback(
    async (nextProviders: ConfiguredProviders) => {
      setIsSaving(true);
      try {
        await onSave(nextProviders);
      } catch (error) {
        setDraftMode(null);
        Alert.alert(
          t("settings.metadataGeneration.saveError"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsSaving(false);
      }
    },
    [onSave, t],
  );

  const handleModeChange = useCallback(
    (next: SelectionMode) => {
      setDraftMode(next);
      if (next === "automatic") {
        void saveProviders([]);
      }
    },
    [saveProviders],
  );

  const handleModelSelect = useCallback(
    (provider: AgentProvider, model: string) => {
      setDraftMode("preferred");
      void saveProviders([
        { provider, ...(model ? { model } : {}) },
        ...configuredProviders.slice(1),
      ]);
    },
    [configuredProviders, saveProviders],
  );
  const handleOpen = useCallback(
    () => onOpen(configuredProvider?.provider),
    [configuredProvider?.provider, onOpen],
  );

  return (
    <View style={styles.modelGroup}>
      <View style={styles.modelHeading}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.metadataGeneration.selection")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {mode === "automatic"
                ? automaticHint
                : t("settings.metadataGeneration.preferredHint")}
            </Text>
          </View>
          <SegmentedControl
            options={modeOptions}
            value={mode}
            onValueChange={handleModeChange}
            size="sm"
            testID={`${id}-mode`}
          />
        </View>
        {mode === "preferred" ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.metadataGeneration.model")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.metadataGeneration.fallbackHint")}
              </Text>
            </View>
            <CombinedModelSelector
              providers={providers}
              selectedProvider={configuredProvider?.provider ?? ""}
              selectedModel={configuredProvider?.model ?? ""}
              onSelect={handleModelSelect}
              isLoading={isLoading}
              onOpen={handleOpen}
              onRetryProvider={onRefresh}
              isRetryingProvider={isRefreshing}
              disabled={isSaving}
              desktopPlacement="bottom-start"
              desktopMinWidth={360}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function MetadataGenerationPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, isLoading: isConfigLoading, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const { refresh } = snapshot;
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const handleRefreshProvider = useCallback(
    (provider: AgentProvider) => refresh([provider]),
    [refresh],
  );
  const handleMetadataSave = useCallback(
    (next: ConfiguredProviders) => patchConfig({ metadataGeneration: { providers: next } }),
    [patchConfig],
  );
  const handleCommitMessageSave = useCallback(
    (next: ConfiguredProviders) =>
      patchConfig({ metadataGeneration: { commitMessageProviders: next } }),
    [patchConfig],
  );
  const handleQuickAskSave = useCallback(
    (next: ConfiguredProviders) => patchConfig({ quickAsk: { providers: next } }),
    [patchConfig],
  );

  if (isConfigLoading || !config) {
    return (
      <View style={styles.loading}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  const sharedProps = {
    providers,
    isLoading: snapshot.isLoading || snapshot.isFetching,
    isRefreshing: snapshot.isRefreshing,
    onOpen: snapshot.refetchIfStale,
    onRefresh: handleRefreshProvider,
  };

  return (
    <SettingsSection
      title={t("settings.metadataGeneration.title")}
      testID="metadata-generation-settings"
    >
      <Text style={styles.description}>{t("settings.metadataGeneration.description")}</Text>
      <ModelSelectionCard
        {...sharedProps}
        id="metadata-generation"
        title={t("settings.metadataGeneration.defaultModel")}
        hint={t("settings.metadataGeneration.defaultModelHint")}
        automaticHint={t("settings.metadataGeneration.automaticHint")}
        configuredProviders={config.metadataGeneration.providers}
        onSave={handleMetadataSave}
      />
      <ModelSelectionCard
        {...sharedProps}
        id="commit-message-generation"
        title={t("settings.metadataGeneration.commitMessageModel")}
        hint={t("settings.metadataGeneration.commitMessageModelHint")}
        automaticHint={t("settings.metadataGeneration.automaticHint")}
        configuredProviders={config.metadataGeneration.commitMessageProviders ?? []}
        onSave={handleCommitMessageSave}
      />
      <ModelSelectionCard
        {...sharedProps}
        id="quick-ask-generation"
        title={t("settings.metadataGeneration.quickAskModel")}
        hint={t("settings.metadataGeneration.quickAskModelHint")}
        automaticHint={t("settings.metadataGeneration.quickAskAutomaticHint")}
        configuredProviders={config.quickAsk?.providers ?? []}
        onSave={handleQuickAskSave}
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.45,
    marginHorizontal: theme.spacing[1],
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  modelGroup: {
    gap: theme.spacing[2],
  },
  modelHeading: {
    gap: theme.spacing[1],
    marginHorizontal: theme.spacing[1],
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));

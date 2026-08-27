import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { MutableDaemonConfigPatch } from "@omp-desktop/protocol/messages";

import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";

export function ImageGenerationSettingsSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.imageGenerationConfig === true,
  );
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persisted = config?.imageGeneration;
  const persistedModel = persisted?.model ?? "gpt-image-2";
  const persistedBaseUrl = persisted?.baseUrl ?? "";
  const [model, setModel] = useState(persistedModel);
  const [baseUrl, setBaseUrl] = useState(persistedBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setModel(persistedModel);
    setBaseUrl(persistedBaseUrl);
  }, [persistedBaseUrl, persistedModel]);

  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedApiKey = apiKey.trim();
  const hasChanges =
    normalizedModel !== persistedModel ||
    normalizedBaseUrl !== persistedBaseUrl ||
    normalizedApiKey.length > 0;
  const toolsEnabled = config?.mcp.injectIntoAgents !== false;
  const apiKeyIsEnvironmentControlled = persisted?.apiKeySource === "environment";

  const status = useMemo(() => {
    if (!persisted?.apiKeyConfigured) return t("settings.imageGeneration.status.notConfigured");
    if (persisted.apiKeySource === "environment") {
      return t("settings.imageGeneration.status.environment");
    }
    return t("settings.imageGeneration.status.configured");
  }, [persisted?.apiKeyConfigured, persisted?.apiKeySource, t]);

  const showError = useCallback(
    (error: unknown) => {
      Alert.alert(
        t("settings.imageGeneration.saveError"),
        error instanceof Error ? error.message : String(error),
      );
    },
    [t],
  );

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      void patchConfig({ imageGeneration: { enabled } }).catch(showError);
    },
    [patchConfig, showError],
  );

  const handleSave = useCallback(() => {
    if (!normalizedModel) return;
    const imageGeneration: NonNullable<MutableDaemonConfigPatch["imageGeneration"]> = {};
    if (normalizedModel !== persistedModel) imageGeneration.model = normalizedModel;
    if (normalizedBaseUrl !== persistedBaseUrl) {
      imageGeneration.baseUrl = normalizedBaseUrl || null;
    }
    if (normalizedApiKey) imageGeneration.apiKey = normalizedApiKey;

    setIsSaving(true);
    void patchConfig({ imageGeneration })
      .then(() => setApiKey(""))
      .catch(showError)
      .finally(() => setIsSaving(false));
  }, [
    normalizedApiKey,
    normalizedBaseUrl,
    normalizedModel,
    patchConfig,
    persistedBaseUrl,
    persistedModel,
    showError,
  ]);

  const handleRemoveApiKey = useCallback(() => {
    setIsSaving(true);
    void patchConfig({ imageGeneration: { apiKey: null, enabled: false } })
      .then(() => setApiKey(""))
      .catch(showError)
      .finally(() => setIsSaving(false));
  }, [patchConfig, showError]);

  if (!isConnected || !isSupported) return null;

  return (
    <SettingsSection
      title={t("settings.imageGeneration.title")}
      testID="image-generation-settings"
      style={styles.section}
    >
      <View style={[settingsStyles.card, styles.card]}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.imageGeneration.enabled")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.imageGeneration.description")}</Text>
          </View>
          <Switch
            value={persisted?.enabled === true}
            onValueChange={handleEnabledChange}
            disabled={isSaving}
            accessibilityLabel={t("settings.imageGeneration.enabledAccessibilityLabel")}
          />
        </View>

        <Text style={styles.status}>{status}</Text>
        {!toolsEnabled ? (
          <Text style={styles.warning}>{t("settings.imageGeneration.toolsDisabled")}</Text>
        ) : null}

        <View style={styles.form}>
          <Field label={t("settings.imageGeneration.model")}>
            <FormTextInput
              initialValue={persistedModel}
              resetKey={persistedModel}
              onChangeText={setModel}
              editable={!isSaving}
              autoCapitalize="none"
              autoCorrect={false}
              testID="image-generation-model"
            />
          </Field>
          <Field label={t("settings.imageGeneration.baseUrl")}>
            <FormTextInput
              initialValue={persistedBaseUrl}
              resetKey={persistedBaseUrl}
              onChangeText={setBaseUrl}
              editable={!isSaving}
              placeholder="https://api.openai.com/v1"
              autoCapitalize="none"
              autoCorrect={false}
              testID="image-generation-base-url"
            />
          </Field>
          <Field label={t("settings.imageGeneration.apiKey")}>
            <FormTextInput
              initialValue=""
              resetKey={`${persisted?.apiKeyConfigured ?? false}:${isSaving}`}
              onChangeText={setApiKey}
              editable={!isSaving && !apiKeyIsEnvironmentControlled}
              placeholder={
                persisted?.apiKeyConfigured
                  ? t("settings.imageGeneration.apiKeyConfiguredPlaceholder")
                  : t("settings.imageGeneration.apiKeyPlaceholder")
              }
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              testID="image-generation-api-key"
            />
          </Field>
        </View>

        <View style={styles.actions}>
          <Button
            variant="default"
            size="sm"
            onPress={handleSave}
            disabled={!hasChanges || !normalizedModel || isSaving}
            testID="image-generation-save"
          >
            {isSaving ? t("settings.imageGeneration.saving") : t("settings.imageGeneration.save")}
          </Button>
          {persisted?.apiKeySource === "config" ? (
            <Button
              variant="outline"
              size="sm"
              onPress={handleRemoveApiKey}
              disabled={isSaving}
              testID="image-generation-remove-key"
            >
              {t("settings.imageGeneration.removeApiKey")}
            </Button>
          ) : null}
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[4],
  },
  card: {
    gap: theme.spacing[3],
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  form: {
    gap: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));

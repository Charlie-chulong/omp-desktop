import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { MutableDaemonConfigPatch } from "@omp-desktop/protocol/messages";

import { formatOmpAccountSelectionLabel } from "@/components/omp-provider-accounts";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useOmpAccountQuota } from "@/hooks/use-omp-account-quota";
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
  const subscriptionSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.imageGenerationSubscription === true,
  );
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persisted = config?.imageGeneration;
  const persistedBackend = persisted?.backend ?? "openai-api";
  const persistedModel = persisted?.model ?? "gpt-image-2";
  const persistedBaseUrl = persisted?.baseUrl ?? "";
  const persistedSubscriptionCredentialId = persisted?.subscriptionCredentialId ?? null;
  const [backend, setBackend] = useState<"openai-api" | "chatgpt-subscription">(persistedBackend);
  const [model, setModel] = useState(persistedModel);
  const [baseUrl, setBaseUrl] = useState(persistedBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [subscriptionCredentialId, setSubscriptionCredentialId] = useState<number | null>(
    persistedSubscriptionCredentialId,
  );
  const [isSaving, setIsSaving] = useState(false);
  const { accounts, loading: accountsLoading } = useOmpAccountQuota(
    serverId,
    backend === "chatgpt-subscription" ? "openai-codex" : null,
    backend === "chatgpt-subscription" ? "gpt-image-2" : null,
  );

  useEffect(() => {
    setBackend(persistedBackend);
    setModel(persistedModel);
    setBaseUrl(persistedBaseUrl);
    setSubscriptionCredentialId(persistedSubscriptionCredentialId);
  }, [persistedBackend, persistedBaseUrl, persistedModel, persistedSubscriptionCredentialId]);

  const accountOptions = useMemo(
    () =>
      accounts.map((account, index) => ({
        id: String(account.credentialId),
        value: account.credentialId,
        label: formatOmpAccountSelectionLabel({
          note: account.note,
          identityKey: account.identityKey,
          fallback: t("settings.imageGeneration.accountFallback", { number: index + 1 }),
        }),
        description: account.quota?.planLabel ?? undefined,
      })),
    [accounts, t],
  );
  const selectedCredentialId =
    subscriptionCredentialId ?? (accounts.length === 1 ? accounts[0]!.credentialId : null);
  const selectedAccountOption =
    accountOptions.find((option) => option.value === selectedCredentialId) ?? null;

  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedApiKey = apiKey.trim();
  const apiSettingsChanged =
    backend === "openai-api" &&
    (normalizedModel !== persistedModel ||
      normalizedBaseUrl !== persistedBaseUrl ||
      normalizedApiKey.length > 0);
  const subscriptionSettingsChanged =
    backend === "chatgpt-subscription" &&
    selectedCredentialId !== persistedSubscriptionCredentialId;
  const hasChanges =
    backend !== persistedBackend || apiSettingsChanged || subscriptionSettingsChanged;
  const toolsEnabled = config?.mcp.injectIntoAgents !== false;
  const apiKeyIsEnvironmentControlled = persisted?.apiKeySource === "environment";

  const status = useMemo(() => {
    if (backend === "chatgpt-subscription") {
      if (accounts.length === 0) {
        return t("settings.imageGeneration.status.noSubscriptionAccount");
      }
      if (!selectedAccountOption) {
        return t("settings.imageGeneration.status.selectSubscriptionAccount");
      }
      return t("settings.imageGeneration.status.subscriptionConfigured", {
        account: selectedAccountOption.label,
        plan: selectedAccountOption.description ?? t("settings.imageGeneration.unknownPlan"),
      });
    }
    if (!persisted?.apiKeyConfigured) return t("settings.imageGeneration.status.notConfigured");
    if (persisted.apiKeySource === "environment") {
      return t("settings.imageGeneration.status.environment");
    }
    return t("settings.imageGeneration.status.configured");
  }, [
    accounts.length,
    backend,
    persisted?.apiKeyConfigured,
    persisted?.apiKeySource,
    selectedAccountOption,
    t,
  ]);

  const sourceOptions = useMemo(
    () => [
      {
        value: "openai-api" as const,
        label: t("settings.imageGeneration.source.api"),
        testID: "image-generation-source-api",
      },
      ...(subscriptionSupported
        ? [
            {
              value: "chatgpt-subscription" as const,
              label: t("settings.imageGeneration.source.subscription"),
              testID: "image-generation-source-subscription",
            },
          ]
        : []),
    ],
    [subscriptionSupported, t],
  );

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
    if (backend === "openai-api" && !normalizedModel) return;
    if (backend === "chatgpt-subscription" && selectedCredentialId === null) return;
    const imageGeneration: NonNullable<MutableDaemonConfigPatch["imageGeneration"]> = {};
    if (backend !== persistedBackend) imageGeneration.backend = backend;
    if (backend === "openai-api") {
      if (normalizedModel !== persistedModel) imageGeneration.model = normalizedModel;
      if (normalizedBaseUrl !== persistedBaseUrl) {
        imageGeneration.baseUrl = normalizedBaseUrl || null;
      }
      if (normalizedApiKey) imageGeneration.apiKey = normalizedApiKey;
    } else if (selectedCredentialId !== persistedSubscriptionCredentialId) {
      imageGeneration.subscriptionCredentialId = selectedCredentialId;
    }

    setIsSaving(true);
    void patchConfig({ imageGeneration })
      .then(() => setApiKey(""))
      .catch(showError)
      .finally(() => setIsSaving(false));
  }, [
    backend,
    normalizedApiKey,
    normalizedBaseUrl,
    normalizedModel,
    patchConfig,
    persistedBackend,
    persistedBaseUrl,
    persistedModel,
    persistedSubscriptionCredentialId,
    selectedCredentialId,
    showError,
  ]);

  const handleRemoveApiKey = useCallback(() => {
    setIsSaving(true);
    void patchConfig({
      imageGeneration: {
        apiKey: null,
        ...(persistedBackend === "openai-api" ? { enabled: false } : {}),
      },
    })
      .then(() => setApiKey(""))
      .catch(showError)
      .finally(() => setIsSaving(false));
  }, [patchConfig, persistedBackend, showError]);

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
            disabled={isSaving || hasChanges}
            accessibilityLabel={t("settings.imageGeneration.enabledAccessibilityLabel")}
          />
        </View>

        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.imageGeneration.source.label")}
            </Text>
            <Text style={settingsStyles.rowHint}>{t("settings.imageGeneration.source.hint")}</Text>
          </View>
          <SegmentedControl
            options={sourceOptions}
            value={backend}
            onValueChange={setBackend}
            size="sm"
            testID="image-generation-source"
          />
        </View>

        <Text style={styles.status}>{status}</Text>
        {!toolsEnabled ? (
          <Text style={styles.warning}>{t("settings.imageGeneration.toolsDisabled")}</Text>
        ) : null}

        {backend === "openai-api" ? (
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
        ) : (
          <View style={styles.form}>
            <SelectField
              label={t("settings.imageGeneration.subscriptionAccount")}
              value={selectedCredentialId}
              selectedDisplay={
                selectedAccountOption
                  ? {
                      label: selectedAccountOption.label,
                      description: selectedAccountOption.description,
                    }
                  : null
              }
              options={accountOptions}
              onChange={setSubscriptionCredentialId}
              placeholder={t("settings.imageGeneration.subscriptionAccountPlaceholder")}
              emptyText={t("settings.imageGeneration.subscriptionAccountEmpty")}
              loading={accountsLoading}
              disabled={isSaving}
              hint={t("settings.imageGeneration.subscriptionHint")}
              testID="image-generation-subscription-account"
            />
            <Field label={t("settings.imageGeneration.model")}>
              <Text style={styles.fixedValue}>gpt-image-2</Text>
            </Field>
          </View>
        )}

        <View style={styles.actions}>
          <Button
            variant="default"
            size="sm"
            onPress={handleSave}
            disabled={
              !hasChanges ||
              isSaving ||
              (backend === "openai-api" ? !normalizedModel : selectedCredentialId === null)
            }
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
  fixedValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
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

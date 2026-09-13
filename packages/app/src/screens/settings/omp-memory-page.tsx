import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type {
  OmpMemoryBackend,
  OmpMemorySettings,
  OmpMemorySettingsPatch,
} from "@omp-desktop/protocol/messages";

import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "./settings-section";
import {
  buildOmpMemorySettingsPatch,
  createOmpMemoryDraft,
  validateOmpMemoryDraft,
  type OmpMemoryDraft,
  type OmpMemoryDraftErrors,
} from "./omp-memory-form";

type MemoryScoping = OmpMemorySettings["mnemopi"]["scoping"];
type MemorySecretKey = keyof NonNullable<OmpMemorySettingsPatch["secrets"]>;

interface ToggleRowProps {
  title: string;
  hint?: string;
  value: boolean;
  disabled: boolean;
  bordered?: boolean;
  testID: string;
  onChange: (value: boolean) => void;
}

function ToggleRow({
  title,
  hint,
  value,
  disabled,
  bordered,
  testID,
  onChange,
}: ToggleRowProps): ReactElement {
  return (
    <View style={[settingsStyles.row, bordered && settingsStyles.rowBorder]} testID={testID}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

interface DraftTextFieldProps {
  label: string;
  value: string;
  resetKey: number;
  disabled: boolean;
  error?: string;
  placeholder?: string;
  secure?: boolean;
  testID: string;
  onChange: (value: string) => void;
}

function DraftTextField({
  label,
  value,
  resetKey,
  disabled,
  error,
  placeholder,
  secure,
  testID,
  onChange,
}: DraftTextFieldProps): ReactElement {
  return (
    <Field label={label} error={error} testID={`${testID}-field`}>
      <FormTextInput
        initialValue={value}
        resetKey={resetKey}
        onChangeText={onChange}
        editable={!disabled}
        placeholder={placeholder}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
      />
    </Field>
  );
}

function StatusRow({
  label,
  value,
  bordered,
}: {
  label: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <View style={[settingsStyles.row, bordered && settingsStyles.rowBorder]}>
      <Text style={settingsStyles.rowTitle}>{label}</Text>
      <Text style={styles.statusValue} selectable numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function HostMemoryPage({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ompMemoryManagement === true,
  );
  const [settings, setSettings] = useState<OmpMemorySettings | null>(null);
  const [draft, setDraft] = useState<OmpMemoryDraft | null>(null);
  const [errors, setErrors] = useState<OmpMemoryDraftErrors>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);

  const load = useCallback(async () => {
    if (!client || !connected || !supported) return;
    setLoading(true);
    setError(null);
    try {
      const next = await client.getOmpMemorySettings();
      setSettings(next);
      setDraft(createOmpMemoryDraft(next));
      setDraftVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client, connected, supported]);

  useEffect(() => {
    if (!connected || !supported) {
      setSettings(null);
      setDraft(null);
      return;
    }
    void load();
  }, [connected, load, supported]);

  const backendOptions = useMemo<SelectFieldOption<OmpMemoryBackend>[]>(() => {
    if (!settings) return [];
    const known: Record<OmpMemoryBackend, { label: string; description: string }> = {
      off: {
        label: t("settings.memory.backend.off.label"),
        description: t("settings.memory.backend.off.description"),
      },
      local: {
        label: t("settings.memory.backend.local.label"),
        description: t("settings.memory.backend.local.description"),
      },
      mnemopi: {
        label: t("settings.memory.backend.mnemopi.label"),
        description: t("settings.memory.backend.mnemopi.description"),
      },
      hindsight: {
        label: t("settings.memory.backend.hindsight.label"),
        description: t("settings.memory.backend.hindsight.description"),
      },
      sharpshooter: {
        label: t("settings.memory.backend.sharpshooter.label"),
        description: t("settings.memory.backend.sharpshooter.description"),
      },
    };
    return settings.supportedBackends.map((backend) => ({
      id: backend,
      value: backend,
      ...known[backend],
    }));
  }, [settings, t]);

  const scopingOptions = useMemo<SelectFieldOption<MemoryScoping>[]>(
    () => [
      {
        id: "per-project",
        value: "per-project",
        label: t("settings.memory.scoping.perProject"),
        description: t("settings.memory.scoping.perProjectHint"),
      },
      {
        id: "per-project-tagged",
        value: "per-project-tagged",
        label: t("settings.memory.scoping.perProjectTagged"),
        description: t("settings.memory.scoping.perProjectTaggedHint"),
      },
      {
        id: "global",
        value: "global",
        label: t("settings.memory.scoping.global"),
        description: t("settings.memory.scoping.globalHint"),
      },
    ],
    [t],
  );

  const validationMessage = useCallback(
    (field: keyof OmpMemoryDraft): string | undefined => {
      const key = errors[field];
      return key ? t(`settings.memory.${key}`) : undefined;
    },
    [errors, t],
  );

  const patch = settings && draft ? buildOmpMemorySettingsPatch(settings, draft) : null;
  const dirty = patch ? Object.keys(patch).length > 0 : false;
  const disabled = saving || loading;

  const save = useCallback(async () => {
    if (!client || !settings || !draft) return;
    const nextErrors = validateOmpMemoryDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const nextPatch = buildOmpMemorySettingsPatch(settings, draft);
    if (Object.keys(nextPatch).length === 0) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await client.updateOmpMemorySettings(settings.revision, nextPatch);
      setSettings(next);
      setDraft(createOmpMemoryDraft(next));
      setDraftVersion((version) => version + 1);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [client, draft, settings]);

  const cancel = useCallback(() => {
    if (!settings) return;
    setDraft(createOmpMemoryDraft(settings));
    setErrors({});
    setError(null);
    setSaved(false);
    setDraftVersion((version) => version + 1);
  }, [settings]);

  const removeSecret = useCallback(
    async (key: MemorySecretKey) => {
      if (!client || !settings || dirty) return;
      setSaving(true);
      setError(null);
      try {
        const next = await client.updateOmpMemorySettings(settings.revision, {
          secrets: { [key]: null },
        });
        setSettings(next);
        setDraft(createOmpMemoryDraft(next));
        setDraftVersion((version) => version + 1);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSaving(false);
      }
    },
    [client, dirty, settings],
  );

  if (!connected) {
    return <MessageCard message={t("settings.memory.unavailable")} />;
  }
  if (!supported) {
    return <MessageCard message={t("settings.memory.unsupported")} />;
  }
  if (loading && !settings) {
    return <MessageCard message={t("settings.memory.loading")} />;
  }
  if (!settings || !draft) {
    return (
      <MessageCard
        message={error ?? t("settings.memory.loadError")}
        action={<Button onPress={() => void load()}>{t("settings.memory.reload")}</Button>}
      />
    );
  }

  const selectedBackend = backendOptions.find((option) => option.value === draft.backend) ?? null;
  const currentBackend = backendOptions.find((option) => option.value === settings.backend) ?? null;
  const currentScoping =
    settings.backend === "mnemopi"
      ? settings.mnemopi.scoping
      : settings.backend === "hindsight"
        ? settings.hindsight.scoping
        : null;
  const currentScopingDisplay = scopingOptions.find((option) => option.value === currentScoping);
  const envOverrides = new Set(settings.environmentOverrides);

  return (
    <View>
      <SettingsSection title={t("settings.memory.overview.title")}>
        <View style={settingsStyles.card}>
          <StatusRow
            label={t("settings.memory.overview.backend")}
            value={currentBackend?.label ?? settings.backend}
          />
          <StatusRow
            bordered
            label={t("settings.memory.overview.storage")}
            value={
              settings.backend === "hindsight"
                ? t("settings.memory.overview.storageRemote")
                : t("settings.memory.overview.storageLocal")
            }
          />
          {currentScopingDisplay ? (
            <StatusRow
              bordered
              label={t("settings.memory.overview.scoping")}
              value={currentScopingDisplay.label}
            />
          ) : null}
          <StatusRow
            bordered
            label={t("settings.memory.overview.configPath")}
            value={settings.configPath}
          />
          <Text style={styles.notice}>{t("settings.memory.overview.newSessions")}</Text>
        </View>
      </SettingsSection>

      <SettingsSection title={t("settings.memory.backend.title")}>
        <View style={[settingsStyles.card, styles.formCard]}>
          <SelectField
            label={t("settings.memory.backend.label")}
            value={draft.backend}
            selectedDisplay={selectedBackend}
            options={backendOptions}
            onChange={(backend) => setDraft({ ...draft, backend })}
            placeholder={t("settings.memory.backend.label")}
            emptyText={t("settings.memory.backend.empty")}
            disabled={disabled}
            testID="omp-memory-backend"
          />
        </View>
      </SettingsSection>

      {draft.backend !== "off" ? (
        <SettingsSection title={t("settings.memory.autolearn.title")}>
          <View style={settingsStyles.card}>
            <ToggleRow
              title={t("settings.memory.autolearn.enabled")}
              hint={t("settings.memory.autolearn.enabledHint")}
              value={draft.autolearnEnabled}
              disabled={disabled}
              testID="omp-memory-autolearn"
              onChange={(autolearnEnabled) => setDraft({ ...draft, autolearnEnabled })}
            />
            <ToggleRow
              bordered
              title={t("settings.memory.autolearn.autoContinue")}
              hint={t("settings.memory.autolearn.autoContinueHint")}
              value={draft.autolearnAutoContinue}
              disabled={disabled || !draft.autolearnEnabled}
              testID="omp-memory-autolearn-auto-continue"
              onChange={(autolearnAutoContinue) => setDraft({ ...draft, autolearnAutoContinue })}
            />
          </View>
        </SettingsSection>
      ) : null}

      {draft.backend === "local" ? (
        <LocalSettings
          draft={draft}
          disabled={disabled}
          resetKey={draftVersion}
          errorFor={validationMessage}
          onChange={setDraft}
        />
      ) : null}
      {draft.backend === "mnemopi" ? (
        <MnemopiSettings
          draft={draft}
          settings={settings}
          disabled={disabled}
          dirty={dirty}
          resetKey={draftVersion}
          showAdvanced={showAdvanced}
          scopingOptions={scopingOptions}
          errorFor={validationMessage}
          onChange={setDraft}
          onToggleAdvanced={() => setShowAdvanced((value) => !value)}
          onRemoveSecret={removeSecret}
        />
      ) : null}
      {draft.backend === "hindsight" ? (
        <HindsightSettings
          draft={draft}
          settings={settings}
          disabled={disabled}
          dirty={dirty}
          resetKey={draftVersion}
          scopingOptions={scopingOptions}
          environmentOverrides={envOverrides}
          errorFor={validationMessage}
          onChange={setDraft}
          onRemoveSecret={removeSecret}
        />
      ) : null}

      <View style={styles.actions}>
        <Button variant="secondary" onPress={cancel} disabled={!dirty || saving}>
          {t("settings.memory.cancel")}
        </Button>
        <Button onPress={() => void save()} disabled={!dirty || disabled} testID="omp-memory-save">
          {saving ? t("settings.memory.saving") : t("settings.memory.save")}
        </Button>
      </View>
      {saved ? <Text style={styles.success}>{t("settings.memory.saved")}</Text> : null}
      {error ? <Text style={settingsStyles.rowError}>{error}</Text> : null}
      <View style={styles.bottomSpacer} />
    </View>
  );
}

function MessageCard({
  message,
  action,
}: {
  message: string;
  action?: ReactElement;
}): ReactElement {
  return (
    <View style={[settingsStyles.card, styles.messageCard]}>
      <Text style={styles.muted}>{message}</Text>
      {action}
    </View>
  );
}

interface BackendSettingsProps {
  draft: OmpMemoryDraft;
  disabled: boolean;
  resetKey: number;
  errorFor: (field: keyof OmpMemoryDraft) => string | undefined;
  onChange: (draft: OmpMemoryDraft) => void;
}

function LocalSettings({
  draft,
  disabled,
  resetKey,
  errorFor,
  onChange,
}: BackendSettingsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t("settings.memory.local.title")}>
      <View style={[settingsStyles.card, styles.formCard]}>
        <DraftTextField
          label={t("settings.memory.local.idleHours")}
          value={draft.localMinRolloutIdleHours}
          resetKey={resetKey}
          disabled={disabled}
          error={errorFor("localMinRolloutIdleHours")}
          testID="omp-memory-local-idle-hours"
          onChange={(localMinRolloutIdleHours) => onChange({ ...draft, localMinRolloutIdleHours })}
        />
        <DraftTextField
          label={t("settings.memory.local.maxAgeDays")}
          value={draft.localMaxRolloutAgeDays}
          resetKey={resetKey}
          disabled={disabled}
          error={errorFor("localMaxRolloutAgeDays")}
          testID="omp-memory-local-max-age"
          onChange={(localMaxRolloutAgeDays) => onChange({ ...draft, localMaxRolloutAgeDays })}
        />
        <DraftTextField
          label={t("settings.memory.local.tokenLimit")}
          value={draft.localSummaryInjectionTokenLimit}
          resetKey={resetKey}
          disabled={disabled}
          error={errorFor("localSummaryInjectionTokenLimit")}
          testID="omp-memory-local-token-limit"
          onChange={(localSummaryInjectionTokenLimit) =>
            onChange({ ...draft, localSummaryInjectionTokenLimit })
          }
        />
      </View>
    </SettingsSection>
  );
}

interface MnemopiSettingsProps extends BackendSettingsProps {
  settings: OmpMemorySettings;
  dirty: boolean;
  showAdvanced: boolean;
  scopingOptions: SelectFieldOption<MemoryScoping>[];
  onToggleAdvanced: () => void;
  onRemoveSecret: (key: MemorySecretKey) => Promise<void>;
}

function MnemopiSettings({
  draft,
  settings,
  disabled,
  dirty,
  resetKey,
  showAdvanced,
  scopingOptions,
  errorFor,
  onChange,
  onToggleAdvanced,
  onRemoveSecret,
}: MnemopiSettingsProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const selectedScoping =
    scopingOptions.find((option) => option.value === draft.mnemopiScoping) ?? null;
  const embeddingOptions: SelectFieldOption<OmpMemoryDraft["mnemopiEmbeddingVariant"]>[] = [
    { id: "en", value: "en", label: t("settings.memory.mnemopi.embeddingEnglish") },
    {
      id: "multilingual",
      value: "multilingual",
      label: t("settings.memory.mnemopi.embeddingMultilingual"),
    },
  ];
  const llmOptions: SelectFieldOption<OmpMemoryDraft["mnemopiLlmMode"]>[] = [
    { id: "smol", value: "smol", label: t("settings.memory.mnemopi.llmSmol") },
    { id: "remote", value: "remote", label: t("settings.memory.mnemopi.llmRemote") },
    { id: "none", value: "none", label: t("settings.memory.mnemopi.llmNone") },
  ];
  return (
    <SettingsSection title={t("settings.memory.mnemopi.title")}>
      <View style={settingsStyles.card}>
        <View style={styles.formBlock}>
          <SelectField
            label={t("settings.memory.mnemopi.scoping")}
            value={draft.mnemopiScoping}
            selectedDisplay={selectedScoping}
            options={scopingOptions}
            onChange={(mnemopiScoping) => onChange({ ...draft, mnemopiScoping })}
            placeholder={t("settings.memory.mnemopi.scoping")}
            emptyText={t("settings.memory.backend.empty")}
            disabled={disabled}
            testID="omp-memory-mnemopi-scoping"
          />
          {draft.mnemopiScoping === "global" ? (
            <Text style={styles.warning}>{t("settings.memory.mnemopi.globalWarning")}</Text>
          ) : null}
        </View>
        <ToggleRow
          bordered
          title={t("settings.memory.mnemopi.autoRecall")}
          value={draft.mnemopiAutoRecall}
          disabled={disabled}
          testID="omp-memory-mnemopi-auto-recall"
          onChange={(mnemopiAutoRecall) => onChange({ ...draft, mnemopiAutoRecall })}
        />
        <ToggleRow
          bordered
          title={t("settings.memory.mnemopi.autoRetain")}
          value={draft.mnemopiAutoRetain}
          disabled={disabled}
          testID="omp-memory-mnemopi-auto-retain"
          onChange={(mnemopiAutoRetain) => onChange({ ...draft, mnemopiAutoRetain })}
        />
        <View style={[styles.formBlock, settingsStyles.rowBorder]}>
          <DraftTextField
            label={t("settings.memory.mnemopi.retainEvery")}
            value={draft.mnemopiRetainEveryNTurns}
            resetKey={resetKey}
            disabled={disabled || !draft.mnemopiAutoRetain}
            error={errorFor("mnemopiRetainEveryNTurns")}
            testID="omp-memory-mnemopi-retain-every"
            onChange={(mnemopiRetainEveryNTurns) =>
              onChange({ ...draft, mnemopiRetainEveryNTurns })
            }
          />
          <DraftTextField
            label={t("settings.memory.mnemopi.recallLimit")}
            value={draft.mnemopiRecallLimit}
            resetKey={resetKey}
            disabled={disabled}
            error={errorFor("mnemopiRecallLimit")}
            testID="omp-memory-mnemopi-recall-limit"
            onChange={(mnemopiRecallLimit) => onChange({ ...draft, mnemopiRecallLimit })}
          />
        </View>
        <Pressable
          style={[styles.advancedButton, settingsStyles.rowBorder]}
          onPress={onToggleAdvanced}
        >
          <Text style={styles.advancedText}>{t("settings.memory.advanced")}</Text>
          {showAdvanced ? (
            <ChevronUp size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          ) : (
            <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          )}
        </Pressable>
        {showAdvanced ? (
          <View style={[styles.formBlock, settingsStyles.rowBorder]}>
            <DraftTextField
              label={t("settings.memory.mnemopi.recallContextTurns")}
              value={draft.mnemopiRecallContextTurns}
              resetKey={resetKey}
              disabled={disabled}
              error={errorFor("mnemopiRecallContextTurns")}
              testID="omp-memory-mnemopi-context-turns"
              onChange={(mnemopiRecallContextTurns) =>
                onChange({ ...draft, mnemopiRecallContextTurns })
              }
            />
            <DraftTextField
              label={t("settings.memory.mnemopi.recallMaxQueryChars")}
              value={draft.mnemopiRecallMaxQueryChars}
              resetKey={resetKey}
              disabled={disabled}
              error={errorFor("mnemopiRecallMaxQueryChars")}
              testID="omp-memory-mnemopi-query-chars"
              onChange={(mnemopiRecallMaxQueryChars) =>
                onChange({ ...draft, mnemopiRecallMaxQueryChars })
              }
            />
            <DraftTextField
              label={t("settings.memory.mnemopi.injectionTokenLimit")}
              value={draft.mnemopiInjectionTokenLimit}
              resetKey={resetKey}
              disabled={disabled}
              error={errorFor("mnemopiInjectionTokenLimit")}
              testID="omp-memory-mnemopi-token-limit"
              onChange={(mnemopiInjectionTokenLimit) =>
                onChange({ ...draft, mnemopiInjectionTokenLimit })
              }
            />
            <ToggleRow
              title={t("settings.memory.mnemopi.polyphonicRecall")}
              hint={t("settings.memory.mnemopi.polyphonicRecallHint")}
              value={draft.mnemopiPolyphonicRecall}
              disabled={disabled}
              testID="omp-memory-mnemopi-polyphonic"
              onChange={(mnemopiPolyphonicRecall) =>
                onChange({ ...draft, mnemopiPolyphonicRecall })
              }
            />
            <ToggleRow
              title={t("settings.memory.mnemopi.enhancedRecall")}
              value={draft.mnemopiEnhancedRecall}
              disabled={disabled}
              testID="omp-memory-mnemopi-enhanced"
              onChange={(mnemopiEnhancedRecall) => onChange({ ...draft, mnemopiEnhancedRecall })}
            />
            <ToggleRow
              title={t("settings.memory.mnemopi.proactiveLinking")}
              value={draft.mnemopiProactiveLinking}
              disabled={disabled}
              testID="omp-memory-mnemopi-linking"
              onChange={(mnemopiProactiveLinking) =>
                onChange({ ...draft, mnemopiProactiveLinking })
              }
            />
            <ToggleRow
              title={t("settings.memory.mnemopi.noEmbeddings")}
              value={draft.mnemopiNoEmbeddings}
              disabled={disabled}
              testID="omp-memory-mnemopi-no-embeddings"
              onChange={(mnemopiNoEmbeddings) => onChange({ ...draft, mnemopiNoEmbeddings })}
            />
            <SelectField
              label={t("settings.memory.mnemopi.embeddingVariant")}
              value={draft.mnemopiEmbeddingVariant}
              selectedDisplay={
                embeddingOptions.find((option) => option.value === draft.mnemopiEmbeddingVariant) ??
                null
              }
              options={embeddingOptions}
              onChange={(mnemopiEmbeddingVariant) =>
                onChange({ ...draft, mnemopiEmbeddingVariant })
              }
              placeholder={t("settings.memory.mnemopi.embeddingVariant")}
              emptyText={t("settings.memory.backend.empty")}
              disabled={disabled || draft.mnemopiNoEmbeddings}
            />
            <DraftTextField
              label={t("settings.memory.mnemopi.dbPath")}
              value={draft.mnemopiDbPath}
              resetKey={resetKey}
              disabled={disabled}
              testID="omp-memory-mnemopi-db-path"
              onChange={(mnemopiDbPath) => onChange({ ...draft, mnemopiDbPath })}
            />
            <DraftTextField
              label={t("settings.memory.mnemopi.embeddingModel")}
              value={draft.mnemopiEmbeddingModel}
              resetKey={resetKey}
              disabled={disabled || draft.mnemopiNoEmbeddings}
              testID="omp-memory-mnemopi-embedding-model"
              onChange={(mnemopiEmbeddingModel) => onChange({ ...draft, mnemopiEmbeddingModel })}
            />
            <DraftTextField
              label={t("settings.memory.mnemopi.embeddingApiUrl")}
              value={draft.mnemopiEmbeddingApiUrl}
              resetKey={resetKey}
              disabled={disabled || draft.mnemopiNoEmbeddings}
              testID="omp-memory-mnemopi-embedding-url"
              onChange={(mnemopiEmbeddingApiUrl) => onChange({ ...draft, mnemopiEmbeddingApiUrl })}
            />
            <SecretField
              label={t("settings.memory.mnemopi.embeddingApiKey")}
              value={draft.mnemopiEmbeddingApiKey}
              configured={settings.secretState.mnemopiEmbeddingApiKey.configured}
              resetKey={resetKey}
              disabled={disabled || draft.mnemopiNoEmbeddings}
              testID="omp-memory-mnemopi-embedding-key"
              onChange={(mnemopiEmbeddingApiKey) => onChange({ ...draft, mnemopiEmbeddingApiKey })}
              onRemove={() => void onRemoveSecret("mnemopiEmbeddingApiKey")}
              removeDisabled={dirty}
            />
            <SelectField
              label={t("settings.memory.mnemopi.llmMode")}
              value={draft.mnemopiLlmMode}
              selectedDisplay={
                llmOptions.find((option) => option.value === draft.mnemopiLlmMode) ?? null
              }
              options={llmOptions}
              onChange={(mnemopiLlmMode) => onChange({ ...draft, mnemopiLlmMode })}
              placeholder={t("settings.memory.mnemopi.llmMode")}
              emptyText={t("settings.memory.backend.empty")}
              disabled={disabled}
            />
            {draft.mnemopiLlmMode === "remote" ? (
              <>
                <DraftTextField
                  label={t("settings.memory.mnemopi.llmBaseUrl")}
                  value={draft.mnemopiLlmBaseUrl}
                  resetKey={resetKey}
                  disabled={disabled}
                  testID="omp-memory-mnemopi-llm-url"
                  onChange={(mnemopiLlmBaseUrl) => onChange({ ...draft, mnemopiLlmBaseUrl })}
                />
                <DraftTextField
                  label={t("settings.memory.mnemopi.llmModel")}
                  value={draft.mnemopiLlmModel}
                  resetKey={resetKey}
                  disabled={disabled}
                  testID="omp-memory-mnemopi-llm-model"
                  onChange={(mnemopiLlmModel) => onChange({ ...draft, mnemopiLlmModel })}
                />
                <SecretField
                  label={t("settings.memory.mnemopi.llmApiKey")}
                  value={draft.mnemopiLlmApiKey}
                  configured={settings.secretState.mnemopiLlmApiKey.configured}
                  resetKey={resetKey}
                  disabled={disabled}
                  testID="omp-memory-mnemopi-llm-key"
                  onChange={(mnemopiLlmApiKey) => onChange({ ...draft, mnemopiLlmApiKey })}
                  onRemove={() => void onRemoveSecret("mnemopiLlmApiKey")}
                  removeDisabled={dirty}
                />
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

interface HindsightSettingsProps extends BackendSettingsProps {
  settings: OmpMemorySettings;
  dirty: boolean;
  scopingOptions: SelectFieldOption<MemoryScoping>[];
  environmentOverrides: Set<string>;
  onRemoveSecret: (key: MemorySecretKey) => Promise<void>;
}

function HindsightSettings({
  draft,
  settings,
  disabled,
  dirty,
  resetKey,
  scopingOptions,
  environmentOverrides,
  errorFor,
  onChange,
  onRemoveSecret,
}: HindsightSettingsProps): ReactElement {
  const { t } = useTranslation();
  const selectedScoping =
    scopingOptions.find((option) => option.value === draft.hindsightScoping) ?? null;
  const tokenState = settings.secretState.hindsightApiToken;
  return (
    <SettingsSection title={t("settings.memory.hindsight.title")}>
      <View style={[settingsStyles.card, styles.formCard]}>
        <DraftTextField
          label={t("settings.memory.hindsight.apiUrl")}
          value={draft.hindsightApiUrl}
          resetKey={resetKey}
          disabled={disabled || environmentOverrides.has("hindsight.apiUrl")}
          error={errorFor("hindsightApiUrl")}
          placeholder="http://localhost:8888"
          testID="omp-memory-hindsight-url"
          onChange={(hindsightApiUrl) => onChange({ ...draft, hindsightApiUrl })}
        />
        <SecretField
          label={t("settings.memory.hindsight.apiToken")}
          value={draft.hindsightApiToken}
          configured={tokenState.configured}
          environmentControlled={tokenState.source === "environment"}
          resetKey={resetKey}
          disabled={disabled}
          testID="omp-memory-hindsight-token"
          onChange={(hindsightApiToken) => onChange({ ...draft, hindsightApiToken })}
          onRemove={() => void onRemoveSecret("hindsightApiToken")}
          removeDisabled={dirty}
        />
        <SelectField
          label={t("settings.memory.hindsight.scoping")}
          value={draft.hindsightScoping}
          selectedDisplay={selectedScoping}
          options={scopingOptions}
          onChange={(hindsightScoping) => onChange({ ...draft, hindsightScoping })}
          placeholder={t("settings.memory.hindsight.scoping")}
          emptyText={t("settings.memory.backend.empty")}
          disabled={disabled || environmentOverrides.has("hindsight.scoping")}
          testID="omp-memory-hindsight-scoping"
        />
        <DraftTextField
          label={t("settings.memory.hindsight.bankId")}
          value={draft.hindsightBankId}
          resetKey={resetKey}
          disabled={disabled || environmentOverrides.has("hindsight.bankId")}
          testID="omp-memory-hindsight-bank"
          onChange={(hindsightBankId) => onChange({ ...draft, hindsightBankId })}
        />
        <ToggleRow
          title={t("settings.memory.hindsight.autoRecall")}
          value={draft.hindsightAutoRecall}
          disabled={disabled || environmentOverrides.has("hindsight.autoRecall")}
          testID="omp-memory-hindsight-auto-recall"
          onChange={(hindsightAutoRecall) => onChange({ ...draft, hindsightAutoRecall })}
        />
        <ToggleRow
          title={t("settings.memory.hindsight.autoRetain")}
          value={draft.hindsightAutoRetain}
          disabled={disabled || environmentOverrides.has("hindsight.autoRetain")}
          testID="omp-memory-hindsight-auto-retain"
          onChange={(hindsightAutoRetain) => onChange({ ...draft, hindsightAutoRetain })}
        />
        <DraftTextField
          label={t("settings.memory.hindsight.retainEvery")}
          value={draft.hindsightRetainEveryNTurns}
          resetKey={resetKey}
          disabled={
            disabled ||
            !draft.hindsightAutoRetain ||
            environmentOverrides.has("hindsight.retainEveryNTurns")
          }
          error={errorFor("hindsightRetainEveryNTurns")}
          testID="omp-memory-hindsight-retain-every"
          onChange={(hindsightRetainEveryNTurns) =>
            onChange({ ...draft, hindsightRetainEveryNTurns })
          }
        />
      </View>
    </SettingsSection>
  );
}

interface SecretFieldProps {
  label: string;
  value: string;
  configured: boolean;
  environmentControlled?: boolean;
  resetKey: number;
  disabled: boolean;
  removeDisabled: boolean;
  testID: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}

function SecretField({
  label,
  value,
  configured,
  environmentControlled,
  resetKey,
  disabled,
  removeDisabled,
  testID,
  onChange,
  onRemove,
}: SecretFieldProps): ReactElement {
  const { t } = useTranslation();
  const hint = environmentControlled
    ? t("settings.memory.hindsight.environment")
    : configured
      ? t("settings.memory.hindsight.configured")
      : undefined;
  return (
    <View style={styles.secretRow}>
      <View style={styles.secretInput}>
        <Field label={label} hint={hint}>
          <FormTextInput
            initialValue={value}
            resetKey={resetKey}
            onChangeText={onChange}
            editable={!disabled && !environmentControlled}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID={testID}
          />
        </Field>
      </View>
      {configured && !environmentControlled ? (
        <Button variant="secondary" onPress={onRemove} disabled={disabled || removeDisabled}>
          {t("settings.memory.removeSecret")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  statusValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    maxWidth: "65%",
    textAlign: "right",
  },
  notice: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  formCard: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  formBlock: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  advancedButton: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  advancedText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  success: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
    textAlign: "right",
  },
  messageCard: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    alignItems: "flex-start",
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  secretRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  secretInput: {
    flex: 1,
  },
  bottomSpacer: {
    height: theme.spacing[6],
  },
}));

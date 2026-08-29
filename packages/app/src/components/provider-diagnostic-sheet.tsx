import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Trash2,
  X,
} from "lucide-react-native";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { SettingsTextArea } from "@/components/settings-textarea";
import { ScrollableCodeSurface, SurfaceCard } from "@/components/ui/scrollable-code-surface";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatTimeAgo } from "@/utils/time";
import { compareMatchScores, scoreTextFields } from "@omp-desktop/protocol/search/text-match";
import type { AgentModelDefinition } from "@omp-desktop/protocol/agent-types";
import type {
  OmpCustomProviderInput,
  OmpProviderApi,
  OmpProviderManagement,
} from "@omp-desktop/protocol/messages";
import {
  createEmptyProviderDraft,
  configureDiscoveredProviderModels,
  OMP_PROVIDER_APIS,
  parseCustomProviderDraft,
  updateCustomProviderConfigYaml,
  type OmpProviderDraft,
  type OmpProviderModelDraft,
} from "./omp-custom-provider-config";
import {
  loadOmpProviderAccountNotes,
  saveOmpProviderAccountNotes,
  updateOmpProviderAccountNote,
} from "./omp-provider-account-notes";
import { formatOmpAccountIdentity, resolveOmpLoginAction } from "./omp-provider-accounts";
import {
  groupOmpDiscoveredModels,
  resolveProviderDiscoveredModels,
  type OmpDiscoveredModelGroup,
  type ProviderDiscoveredModelsCache,
} from "./provider-diagnostic-models";

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose?: () => void;
  serverId: string;
  inline?: boolean;
}
const NOOP = () => undefined;

function rankModels<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored = items
    .map((item) => ({ item, score: scoreTextFields(query, fields(item)) }))
    .filter(
      (entry): entry is { item: T; score: NonNullable<typeof entry.score> } => entry.score !== null,
    );
  scored.sort((a, b) => compareMatchScores(a.score, b.score));
  return scored.map((entry) => entry.item);
}

function DiscoveredModelRow({
  model,
  providerId,
}: {
  model: AgentModelDefinition;
  providerId: string;
}) {
  const prefix = `${providerId}/`;
  const label = model.label.startsWith(prefix) ? model.label.slice(prefix.length) : model.label;
  const modelId = model.id.startsWith(prefix) ? model.id.slice(prefix.length) : model.id;
  const description = model.description?.startsWith(prefix)
    ? model.description.slice(prefix.length)
    : model.description;
  return (
    <View style={sheetStyles.modelRow}>
      <Text style={sheetStyles.modelTitle} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={sheetStyles.monoHint}
        numberOfLines={1}
        selectable
        dataSet={CODE_SURFACE_DATASET}
      >
        {modelId}
      </Text>
      {description && description !== modelId ? (
        <Text style={sheetStyles.descriptionInline} numberOfLines={1}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

function OmpModelProviderGroup({
  group,
  forceExpanded,
}: {
  group: OmpDiscoveredModelGroup;
  forceExpanded: boolean;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [expanded, setExpanded] = useState(false);
  const isExpanded = forceExpanded || expanded;
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);
  const accessibilityState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);
  return (
    <View style={settingsStyles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          group.models.length === 1
            ? "settings.providers.omp.models.providerGroupOne"
            : "settings.providers.omp.models.providerGroupMany",
          {
            provider: group.label,
            count: group.models.length,
          },
        )}
        accessibilityState={accessibilityState}
        onPress={toggleExpanded}
        style={sheetStyles.modelGroupHeader}
        testID={`omp-model-group-${group.id}`}
      >
        <View style={sheetStyles.modelGroupTitle}>
          {isExpanded ? (
            <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          ) : (
            <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          )}
          <Text style={settingsStyles.rowTitle}>{group.label}</Text>
        </View>
        <Text style={sheetStyles.mutedText}>
          {t(
            group.models.length === 1
              ? "settings.providers.models.one"
              : "settings.providers.models.many",
            { count: group.models.length },
          )}
        </Text>
      </Pressable>
      {isExpanded
        ? group.models.map((model) => (
            <DiscoveredModelRow key={model.id} model={model} providerId={group.id} />
          ))
        : null}
    </View>
  );
}

function SectionHeader({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <View style={sheetStyles.sectionHeader}>
      <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
      <View style={sheetStyles.sectionHeaderMeta}>
        {count !== undefined ? (
          <Text style={settingsStyles.sectionHeaderTitle}>{count}</Text>
        ) : null}
        {count !== undefined && hint ? (
          <Text style={settingsStyles.sectionHeaderTitle}>·</Text>
        ) : null}
        {hint ? <Text style={settingsStyles.sectionHeaderTitle}>{hint}</Text> : null}
      </View>
    </View>
  );
}
interface OmpProviderSummary {
  id: string;
  modelCount: number;
  login?: OmpProviderManagement["loginProviders"][number];
}

type OmpProviderAccount = NonNullable<
  OmpProviderManagement["loginProviders"][number]["accounts"]
>[number];

function OmpProviderAccountRow({
  account,
  index,
  note,
  editing,
  noteDraft,
  saving,
  onEdit,
  onChangeNote,
  onSave,
  onCancel,
}: {
  account: OmpProviderAccount;
  index: number;
  note?: string;
  editing: boolean;
  noteDraft: string;
  saving: boolean;
  onEdit: () => void;
  onChangeNote: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const identity = formatOmpAccountIdentity(account.identityKey);
  return (
    <View style={sheetStyles.accountRow} testID={`omp-provider-account-${account.credentialId}`}>
      {editing ? (
        <View style={sheetStyles.accountEditForm}>
          <AdaptiveTextInput
            initialValue={noteDraft}
            resetKey={`${account.credentialId}-${editing}`}
            onChangeText={onChangeNote}
            placeholder={t("settings.providers.omp.multiAccount.notePlaceholder")}
            maxLength={200}
            autoCorrect={false}
            style={sheetStyles.accountNoteInput}
            testID={`omp-provider-account-note-input-${account.credentialId}`}
          />
          <View style={sheetStyles.accountEditActions}>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={X}
              onPress={onCancel}
              disabled={saving}
              testID={`omp-provider-account-note-cancel-${account.credentialId}`}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              leftIcon={saving ? undefined : Save}
              onPress={onSave}
              disabled={saving}
              testID={`omp-provider-account-note-save-${account.credentialId}`}
            >
              {saving
                ? t("settings.providers.omp.multiAccount.savingNote")
                : t("settings.providers.omp.multiAccount.saveNote")}
            </Button>
          </View>
        </View>
      ) : (
        <>
          <View style={sheetStyles.providerSummaryText}>
            <Text style={sheetStyles.accountTitle}>
              {identity.primary ??
                t("settings.providers.omp.multiAccount.fallback", { number: index + 1 })}
            </Text>
            {identity.secondary ? (
              <Text style={sheetStyles.mutedText} numberOfLines={1}>
                {identity.secondary}
              </Text>
            ) : null}
            {note ? (
              <Text style={sheetStyles.accountNote} numberOfLines={2}>
                {note}
              </Text>
            ) : null}
          </View>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={Pencil}
            onPress={onEdit}
            testID={`omp-provider-account-note-edit-${account.credentialId}`}
          >
            {t(
              note
                ? "settings.providers.omp.multiAccount.editNote"
                : "settings.providers.omp.multiAccount.addNote",
            )}
          </Button>
        </>
      )}
    </View>
  );
}

function OmpProviderSummaryRow({
  summary,
  loggingInProviderId,
  loggingOutProviderId,
  removingProviderId,
  accountNotes = {},
  editingAccountId = null,
  accountNoteDraft = "",
  savingAccountNoteId = null,
  onEdit,
  onLogin,
  onRemove,
  onLogout,
  onEditAccountNote,
  onChangeAccountNote,
  onSaveAccountNote,
  onCancelAccountNote,
}: {
  summary: OmpProviderSummary;
  loggingInProviderId: string | null;
  loggingOutProviderId: string | null;
  removingProviderId?: string | null;
  accountNotes?: Record<string, string>;
  editingAccountId?: number | null;
  accountNoteDraft?: string;
  savingAccountNoteId?: number | null;
  onEdit?: (providerId: string) => void;
  onLogin: (providerId: string) => void;
  onLogout?: (providerId: string) => void;
  onRemove?: (providerId: string) => void;
  onEditAccountNote?: (credentialId: number) => void;
  onChangeAccountNote?: (value: string) => void;
  onSaveAccountNote?: () => void;
  onCancelAccountNote?: () => void;
}) {
  const { t } = useTranslation();
  const { login } = summary;
  const accounts = login?.accounts ?? [];
  const loginAction = login ? resolveOmpLoginAction(login) : null;
  const handleLogin = useCallback(() => {
    if (login) onLogin(login.id);
  }, [login, onLogin]);
  const handleLogout = useCallback(() => {
    if (login) onLogout?.(login.id);
  }, [login, onLogout]);
  const handleEdit = useCallback(() => {
    onEdit?.(summary.id);
  }, [onEdit, summary.id]);
  const handleRemove = useCallback(() => {
    onRemove?.(summary.id);
  }, [onRemove, summary.id]);
  const modelCount = t(
    summary.modelCount === 1 ? "settings.providers.models.one" : "settings.providers.models.many",
    { count: summary.modelCount },
  );
  let loginStatus = "";
  if (login) {
    loginStatus = login.authenticated
      ? ` · ${t("settings.providers.omp.provider.signedIn")}`
      : ` · ${t("settings.providers.omp.provider.notSignedIn")}`;
    if (accounts.length > 0) {
      loginStatus += ` · ${t(
        accounts.length === 1
          ? "settings.providers.omp.multiAccount.countOne"
          : "settings.providers.omp.multiAccount.countMany",
        { count: accounts.length },
      )}`;
    }
  }
  return (
    <View style={sheetStyles.providerSummaryBlock}>
      <View style={sheetStyles.providerSummaryRow}>
        <View style={sheetStyles.providerSummaryText}>
          <Text style={sheetStyles.modelTitle}>{login?.name ?? summary.id}</Text>
          <Text style={sheetStyles.mutedText}>
            {modelCount}
            {loginStatus}
          </Text>
        </View>
        <View style={sheetStyles.providerSummaryActions}>
          {login && loginAction ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={loggingInProviderId === login.id ? undefined : LogIn}
              onPress={handleLogin}
              disabled={Boolean(loggingInProviderId || loggingOutProviderId)}
              testID={`omp-login-provider-${login.id}`}
            >
              {loggingInProviderId === login.id
                ? t("settings.providers.omp.provider.starting")
                : t(
                    loginAction === "add-account"
                      ? "settings.providers.omp.multiAccount.add"
                      : "settings.providers.omp.provider.signIn",
                  )}
            </Button>
          ) : null}
          {login?.authenticated && onLogout ? (
            <Button
              variant="destructive"
              size="sm"
              leftIcon={loggingOutProviderId === login.id ? undefined : LogOut}
              onPress={handleLogout}
              disabled={Boolean(loggingInProviderId || loggingOutProviderId)}
              testID={`omp-logout-provider-${login.id}`}
            >
              {loggingOutProviderId === login.id
                ? t("settings.providers.omp.provider.signingOut")
                : t(
                    accounts.length > 1
                      ? "settings.providers.omp.multiAccount.signOutAll"
                      : "settings.providers.omp.provider.signOut",
                  )}
            </Button>
          ) : null}
          {!login && onEdit ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={Pencil}
              onPress={handleEdit}
              disabled={Boolean(removingProviderId)}
              testID={`omp-edit-provider-${summary.id}`}
            >
              {t("settings.providers.omp.custom.editProvider")}
            </Button>
          ) : null}
          {!login && onRemove ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={removingProviderId === summary.id ? undefined : Trash2}
              onPress={handleRemove}
              disabled={Boolean(removingProviderId)}
              testID={`omp-remove-provider-${summary.id}`}
            >
              {removingProviderId === summary.id
                ? t("settings.providers.omp.custom.removingProvider")
                : t("settings.providers.omp.custom.removeProvider")}
            </Button>
          ) : null}
        </View>
      </View>
      {accounts.length > 0 ? (
        <View style={sheetStyles.accountList}>
          {accounts.map((account, index) => (
            <OmpProviderAccountRow
              key={account.credentialId}
              account={account}
              index={index}
              note={accountNotes[String(account.credentialId)]}
              editing={editingAccountId === account.credentialId}
              noteDraft={accountNoteDraft}
              saving={savingAccountNoteId === account.credentialId}
              onEdit={() => onEditAccountNote?.(account.credentialId)}
              onChangeNote={(value) => onChangeAccountNote?.(value)}
              onSave={() => onSaveAccountNote?.()}
              onCancel={() => onCancelAccountNote?.()}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
function parseOptionalPositiveInteger(value: string, errorMessage: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(errorMessage);
  }
  return parsed;
}

function OmpApiMenuItem({
  api,
  selected,
  onSelect,
}: {
  api: OmpProviderApi;
  selected: boolean;
  onSelect: (api: OmpProviderApi) => void;
}) {
  const handleSelect = useCallback(() => onSelect(api), [api, onSelect]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {api}
    </DropdownMenuItem>
  );
}

function OmpApiFormatSelect({
  value,
  onChange,
}: {
  value: OmpProviderApi;
  onChange: (api: OmpProviderApi) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={sheetStyles.apiSelectTrigger}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.omp.custom.apiFormatAccessibility", {
          format: value,
        })}
      >
        <Text style={sheetStyles.apiSelectText}>{value}</Text>
        <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" width={280}>
        {OMP_PROVIDER_APIS.map((api) => (
          <OmpApiMenuItem key={api} api={api} selected={api === value} onSelect={onChange} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OmpProviderModelEditor({
  model,
  revision,
  canRemove,
  onChange,
  onRemove,
}: {
  model: OmpProviderModelDraft;
  revision: number;
  canRemove: boolean;
  onChange: (key: string, patch: Partial<OmpProviderModelDraft>) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const updateId = useCallback((id: string) => onChange(model.key, { id }), [model.key, onChange]);
  const updateName = useCallback(
    (name: string) => onChange(model.key, { name }),
    [model.key, onChange],
  );
  const updateContextWindow = useCallback(
    (contextWindow: string) => onChange(model.key, { contextWindow }),
    [model.key, onChange],
  );
  const updateMaxTokens = useCallback(
    (maxTokens: string) => onChange(model.key, { maxTokens }),
    [model.key, onChange],
  );
  const updateSupportsImages = useCallback(
    (supportsImages: boolean) => onChange(model.key, { supportsImages }),
    [model.key, onChange],
  );
  const handleRemove = useCallback(() => onRemove(model.key), [model.key, onRemove]);
  return (
    <View style={sheetStyles.modelEditor}>
      <View style={sheetStyles.modelEditorHeader}>
        <Text style={sheetStyles.modelEditorTitle}>{t("settings.providers.omp.custom.model")}</Text>
        {canRemove ? (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={Trash2}
            onPress={handleRemove}
            accessibilityLabel={t("settings.providers.omp.custom.removeModel", {
              model: model.id || model.key,
            })}
          >
            {t("settings.providers.omp.custom.remove")}
          </Button>
        ) : null}
      </View>
      <Text style={sheetStyles.formLabel}>{t("settings.providers.omp.custom.modelId")}</Text>
      <AdaptiveTextInput
        initialValue={model.id}
        resetKey={`${revision}-${model.key}-id`}
        onChangeText={updateId}
        placeholder="gpt-5.4"
        autoCapitalize="none"
        autoCorrect={false}
        style={sheetStyles.formInput}
      />
      <Text style={sheetStyles.formLabel}>{t("settings.providers.omp.custom.displayName")}</Text>
      <AdaptiveTextInput
        initialValue={model.name}
        resetKey={`${revision}-${model.key}-name`}
        onChangeText={updateName}
        placeholder="GPT-5.4"
        style={sheetStyles.formInput}
      />
      <View style={sheetStyles.formColumns}>
        <View style={sheetStyles.formColumn}>
          <Text style={sheetStyles.formLabel}>
            {t("settings.providers.omp.custom.contextWindow")}
          </Text>
          <AdaptiveTextInput
            initialValue={model.contextWindow}
            resetKey={`${revision}-${model.key}-context`}
            onChangeText={updateContextWindow}
            placeholder="128000"
            inputMode="numeric"
            style={sheetStyles.formInput}
          />
        </View>
        <View style={sheetStyles.formColumn}>
          <Text style={sheetStyles.formLabel}>
            {t("settings.providers.omp.custom.maxOutputTokens")}
          </Text>
          <AdaptiveTextInput
            initialValue={model.maxTokens}
            resetKey={`${revision}-${model.key}-max`}
            onChangeText={updateMaxTokens}
            placeholder="16384"
            inputMode="numeric"
            style={sheetStyles.formInput}
          />
        </View>
      </View>
      <View style={sheetStyles.modelInputRow}>
        <View style={sheetStyles.modelInputMeta}>
          <Text style={sheetStyles.formLabel}>{t("settings.providers.omp.custom.imageInput")}</Text>
          <Text style={sheetStyles.modelInputHint}>
            {t("settings.providers.omp.custom.imageInputHint")}
          </Text>
        </View>
        <Switch
          value={model.supportsImages}
          onValueChange={updateSupportsImages}
          accessibilityLabel={t("settings.providers.omp.custom.imageInputAccessibility", {
            model: model.name.trim() || model.id.trim() || model.key,
          })}
          testID={`omp-model-image-input-${model.key}`}
        />
      </View>
    </View>
  );
}

type OmpManagementClient = NonNullable<ReturnType<typeof useHostRuntimeClient>>;

function OmpProviderForm({
  client,
  initialDraft,
  editingProviderId,
  configYaml,
  onSaved,
  onCancel,
}: {
  client: OmpManagementClient;
  initialDraft?: OmpProviderDraft;
  editingProviderId?: string;
  configYaml?: string;
  onSaved: (management: OmpProviderManagement) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const nextModelKey = useRef(initialDraft?.models.length ?? 1);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<OmpProviderDraft>(() =>
    initialDraft
      ? { ...initialDraft, models: initialDraft.models.map((model) => ({ ...model })) }
      : createEmptyProviderDraft("model-0"),
  );
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredCount, setDiscoveredCount] = useState<number | null>(null);
  const updateProviderId = useCallback(
    (providerId: string) => setDraft((current) => ({ ...current, providerId })),
    [],
  );
  const updateBaseUrl = useCallback(
    (baseUrl: string) => setDraft((current) => ({ ...current, baseUrl })),
    [],
  );
  const updateApiKey = useCallback(
    (apiKey: string) => setDraft((current) => ({ ...current, apiKey })),
    [],
  );
  const updateApi = useCallback(
    (api: OmpProviderApi) => setDraft((current) => ({ ...current, api })),
    [],
  );
  const updateModel = useCallback((key: string, patch: Partial<OmpProviderModelDraft>) => {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) => (model.key === key ? { ...model, ...patch } : model)),
    }));
  }, []);
  const removeModel = useCallback((key: string) => {
    setDraft((current) => ({
      ...current,
      models: current.models.filter((model) => model.key !== key),
    }));
  }, []);
  const addModel = useCallback(() => {
    const key = `model-${nextModelKey.current}`;
    nextModelKey.current += 1;
    setDraft((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          key,
          id: "",
          name: "",
          contextWindow: "",
          maxTokens: "",
          supportsImages: false,
        },
      ],
    }));
  }, []);
  const handleAddModelPress = useCallback(() => addModel(), [addModel]);
  const enableImageInputForAll = useCallback(() => {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) => ({ ...model, supportsImages: true })),
    }));
  }, []);
  const hasTextOnlyModels = draft.models.some(
    (model) => model.id.trim().length > 0 && !model.supportsImages,
  );
  const discoverModels = useCallback(async () => {
    if (!draft.baseUrl.trim() || !draft.apiKey.trim()) return;
    setDiscovering(true);
    setDiscoveredCount(null);
    setError(null);
    try {
      const result = await client.discoverOmpProviderModels({
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim(),
      });
      setDraft((current) => ({
        ...current,
        models: configureDiscoveredProviderModels(current.models, result.models, () => {
          const key = `model-${nextModelKey.current}`;
          nextModelKey.current += 1;
          return key;
        }),
      }));
      setRevision((current) => current + 1);
      setDiscoveredCount(result.models.length);
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : String(discoverError));
    } finally {
      setDiscovering(false);
    }
  }, [client, draft.apiKey, draft.baseUrl]);
  const handleDiscoverModelsPress = useCallback(() => void discoverModels(), [discoverModels]);
  const canDiscover = draft.baseUrl.trim().length > 0 && draft.apiKey.trim().length > 0;
  const canAdd =
    draft.providerId.trim().length > 0 &&
    draft.baseUrl.trim().length > 0 &&
    draft.apiKey.trim().length > 0 &&
    draft.models.length > 0 &&
    draft.models.every((model) => model.id.trim().length > 0);

  const addProvider = useCallback(async () => {
    if (!canAdd) return;
    setAdding(true);
    setError(null);
    try {
      const provider: OmpCustomProviderInput = {
        providerId: draft.providerId.trim().toLowerCase(),
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim(),
        api: draft.api,
        models: draft.models.map((model) => ({
          id: model.id.trim(),
          ...(model.name.trim() ? { name: model.name.trim() } : {}),
          ...(model.contextWindow.trim()
            ? {
                contextWindow: parseOptionalPositiveInteger(
                  model.contextWindow,
                  t("settings.providers.omp.custom.positiveInteger", {
                    field: t("settings.providers.omp.custom.contextWindow"),
                  }),
                ),
              }
            : {}),
          ...(model.maxTokens.trim()
            ? {
                maxTokens: parseOptionalPositiveInteger(
                  model.maxTokens,
                  t("settings.providers.omp.custom.positiveInteger", {
                    field: t("settings.providers.omp.custom.maxOutputTokens"),
                  }),
                ),
              }
            : {}),
          ...(model.supportsImages ? { supportsImages: true } : {}),
        })),
      };
      const result =
        editingProviderId && configYaml !== undefined
          ? await client.saveOmpProviderConfig(
              updateCustomProviderConfigYaml(configYaml, editingProviderId, provider),
            )
          : await client.addOmpProvider(provider);
      onSaved(result);
      if (!editingProviderId) {
        const key = `model-${nextModelKey.current}`;
        nextModelKey.current += 1;
        setDraft(createEmptyProviderDraft(key));
        setRevision((current) => current + 1);
      }
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
    } finally {
      setAdding(false);
    }
  }, [canAdd, client, configYaml, draft, editingProviderId, onSaved, t]);
  const handleAddPress = useCallback(() => void addProvider(), [addProvider]);
  const addProviderLabel = adding
    ? t(
        editingProviderId
          ? "settings.providers.omp.custom.savingProvider"
          : "settings.providers.omp.custom.validating",
      )
    : editingProviderId
      ? t("settings.providers.omp.custom.saveProvider")
      : t("settings.providers.omp.custom.addWithCount", { count: draft.models.length });

  return (
    <View style={sheetStyles.formGroup}>
      <Text style={sheetStyles.formLabel}>{t("settings.providers.omp.custom.providerId")}</Text>
      <AdaptiveTextInput
        initialValue={draft.providerId}
        resetKey={`${revision}-provider-id`}
        onChangeText={updateProviderId}
        placeholder="mintcat"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!editingProviderId}
        style={sheetStyles.formInput}
      />
      <Text style={sheetStyles.formLabel}>{t("settings.providers.omp.custom.endpointUrl")}</Text>
      <AdaptiveTextInput
        initialValue={draft.baseUrl}
        resetKey={`${revision}-base-url`}
        onChangeText={updateBaseUrl}
        placeholder="https://api.example.com/v1"
        autoCapitalize="none"
        autoCorrect={false}
        style={sheetStyles.formInput}
      />
      <Text style={sheetStyles.formLabel}>{t("settings.providers.omp.custom.apiKey")}</Text>
      <AdaptiveTextInput
        initialValue={draft.apiKey}
        resetKey={`${revision}-api-key`}
        onChangeText={updateApiKey}
        placeholder="sk-..."
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={sheetStyles.formInput}
      />
      <Text style={sheetStyles.formLabel}>{t("settings.providers.omp.custom.apiFormat")}</Text>
      <OmpApiFormatSelect value={draft.api} onChange={updateApi} />
      <Button
        variant="secondary"
        size="sm"
        leftIcon={RotateCw}
        onPress={handleDiscoverModelsPress}
        disabled={!canDiscover || discovering || adding}
      >
        {t(
          discovering
            ? "settings.providers.omp.custom.fetchingModels"
            : "settings.providers.omp.custom.fetchModels",
        )}
      </Button>
      {discoveredCount !== null ? (
        <Text style={sheetStyles.descriptionInline}>
          {t("settings.providers.omp.custom.modelsConfiguredWithImageDefault", {
            count: discoveredCount,
          })}
        </Text>
      ) : null}
      {hasTextOnlyModels ? (
        <View style={sheetStyles.modelListActions}>
          <Button variant="secondary" size="sm" onPress={enableImageInputForAll}>
            {t("settings.providers.omp.custom.enableImageInputForAll")}
          </Button>
        </View>
      ) : null}
      <View style={sheetStyles.modelList}>
        {draft.models.map((model) => (
          <OmpProviderModelEditor
            key={model.key}
            model={model}
            revision={revision}
            canRemove={draft.models.length > 1}
            onChange={updateModel}
            onRemove={removeModel}
          />
        ))}
      </View>
      <Button variant="secondary" size="sm" leftIcon={Plus} onPress={handleAddModelPress}>
        {t("settings.providers.omp.custom.addAnotherModel")}
      </Button>
      {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
      <View style={sheetStyles.formActions}>
        <Button variant="secondary" size="sm" onPress={onCancel} disabled={adding}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          leftIcon={adding ? undefined : Plus}
          onPress={handleAddPress}
          disabled={!canAdd || adding}
        >
          {addProviderLabel}
        </Button>
      </View>
    </View>
  );
}
type OmpManagementTab = "sign-in" | "custom";

function isCustomOmpProvider(
  provider: OmpProviderManagement["providerModels"][number],
  loginProviderIds: Set<string>,
): boolean {
  return (
    provider.source === "custom" ||
    (provider.source === undefined && !loginProviderIds.has(provider.id))
  );
}

function OmpCustomProvidersTab({
  providers,
  management,
  configYaml,
  saving,
  removingProviderId,
  onOpenAddProvider,
  onRemoveProvider,
  onConfigYamlChange,
  onEditProvider,
  onSave,
}: {
  providers: OmpProviderSummary[];
  management: OmpProviderManagement;
  configYaml: string;
  saving: boolean;
  removingProviderId: string | null;
  onOpenAddProvider: () => void;
  onRemoveProvider: (providerId: string) => void;
  onConfigYamlChange: (configYaml: string) => void;
  onSave: () => void;
  onEditProvider: (providerId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={sheetStyles.tabContent}>
      <View style={sheetStyles.customProviderHeader}>
        <Text style={settingsStyles.sectionHeaderTitle}>
          {t("settings.providers.omp.tabs.custom")}
        </Text>
        <Button
          variant="default"
          size="sm"
          leftIcon={Plus}
          onPress={onOpenAddProvider}
          testID="omp-add-custom-provider"
        >
          {t("settings.providers.omp.custom.add")}
        </Button>
      </View>
      {providers.length > 0 ? (
        <View style={settingsStyles.card}>
          {providers.map((summary) => (
            <OmpProviderSummaryRow
              key={summary.id}
              summary={summary}
              loggingInProviderId={null}
              loggingOutProviderId={null}
              removingProviderId={removingProviderId}
              onLogin={NOOP}
              onEdit={onEditProvider}
              onRemove={onRemoveProvider}
            />
          ))}
        </View>
      ) : (
        <SurfaceCard>
          <Text style={sheetStyles.emptyCardText}>{t("settings.providers.omp.empty.custom")}</Text>
        </SurfaceCard>
      )}
      <View style={sheetStyles.section}>
        <SectionHeader
          title={t("settings.providers.omp.yaml.title")}
          hint={management.configPath}
        />
        <SettingsTextArea
          key={`${management.configPath}:${management.configYaml}`}
          accessibilityLabel={t("settings.providers.omp.yaml.accessibility")}
          value={configYaml}
          onChangeText={onConfigYamlChange}
          testID="omp-models-yaml"
          style={sheetStyles.yamlInput}
        />
        <View style={sheetStyles.advancedActions}>
          <Text style={sheetStyles.mutedText}>{t("settings.providers.omp.yaml.hint")}</Text>
          <Button
            variant="default"
            size="sm"
            leftIcon={saving ? undefined : Save}
            onPress={onSave}
            disabled={saving || configYaml === management.configYaml}
          >
            {saving
              ? t("settings.providers.omp.yaml.saving")
              : t("settings.providers.omp.yaml.save")}
          </Button>
        </View>
      </View>
    </View>
  );
}

function OmpManagementPanel({
  serverId,
  visible,
  onSaved,
}: {
  serverId: string;
  visible: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ompProviderManagement === true,
  );
  const [management, setManagement] = useState<OmpProviderManagement | null>(null);
  const [configYaml, setConfigYaml] = useState("");
  const [activeTab, setActiveTab] = useState<OmpManagementTab>("sign-in");
  const [editingProvider, setEditingProvider] = useState<{
    id: string;
    draft: OmpProviderDraft;
  } | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loginProviderId, setLoginProviderId] = useState<string | null>(null);
  const [removingProviderId, setRemovingProviderId] = useState<string | null>(null);
  const [logoutProviderId, setLogoutProviderId] = useState<string | null>(null);
  const [loginFlow, setLoginFlow] = useState<{
    flowId: string;
    providerId: string;
    url: string;
    launchUrl?: string;
    instructions?: string;
  } | null>(null);
  const [loginInput, setLoginInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accountNotes, setAccountNotes] = useState<Record<string, string>>({});
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [accountNoteDraft, setAccountNoteDraft] = useState("");
  const [savingAccountNoteId, setSavingAccountNoteId] = useState<number | null>(null);

  const applyManagement = useCallback(
    (result: OmpProviderManagement) => {
      setManagement(result);
      setConfigYaml(result.configYaml);
      onSaved();
    },
    [onSaved],
  );
  const load = useCallback(async () => {
    if (!client || !supported) return;
    setLoading(true);
    setError(null);
    try {
      applyManagement(await client.getOmpProviderManagement());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [applyManagement, client, supported]);
  useEffect(() => {
    if (visible) {
      void load();
    } else {
      setManagement(null);
      setActiveTab("sign-in");
      setAddProviderOpen(false);
      setLoginFlow(null);
      setEditingProvider(null);
      setLoginInput("");
      setError(null);
    }
  }, [load, visible]);
  useEffect(() => {
    if (!visible) {
      setAccountNotes({});
      setEditingAccountId(null);
      setAccountNoteDraft("");
      setSavingAccountNoteId(null);
      return;
    }
    let mounted = true;
    void loadOmpProviderAccountNotes(AsyncStorage, serverId)
      .then((notes) => {
        if (mounted) setAccountNotes(notes);
      })
      .catch((notesError) => {
        if (mounted) {
          setError(notesError instanceof Error ? notesError.message : String(notesError));
        }
      });
    return () => {
      mounted = false;
    };
  }, [serverId, visible]);
  const save = useCallback(async () => {
    if (!client) return;
    setSaving(true);
    setError(null);
    try {
      applyManagement(await client.saveOmpProviderConfig(configYaml));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [applyManagement, client, configYaml]);
  const startLogin = useCallback(
    async (providerId: string) => {
      if (!client) return;
      setLoginProviderId(providerId);
      setError(null);
      try {
        const flow = await client.startOmpProviderLogin(providerId);
        setLoginFlow({
          flowId: flow.flowId,
          providerId: flow.providerId,
          url: flow.url,
          ...(flow.launchUrl ? { launchUrl: flow.launchUrl } : {}),
          ...(flow.instructions ? { instructions: flow.instructions } : {}),
        });
        await Linking.openURL(flow.launchUrl ?? flow.url).catch((openError) => {
          setError(
            t("settings.providers.omp.login.openFailed", {
              error: openError instanceof Error ? openError.message : String(openError),
            }),
          );
        });
      } catch (loginError) {
        setError(loginError instanceof Error ? loginError.message : String(loginError));
      } finally {
        setLoginProviderId(null);
      }
    },
    [client, t],
  );
  const finishLogin = useCallback(async () => {
    if (!client || !loginFlow) return;
    setLoginProviderId(loginFlow.providerId);
    setError(null);
    try {
      applyManagement(await client.finishOmpProviderLogin(loginFlow.flowId, loginInput));
      setLoginFlow(null);
      setLoginInput("");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setLoginProviderId(null);
    }
  }, [applyManagement, client, loginFlow, loginInput]);
  const logout = useCallback(
    async (providerId: string) => {
      if (!client) return;
      setLogoutProviderId(providerId);
      setError(null);
      try {
        applyManagement(await client.logoutOmpProvider(providerId));
      } catch (logoutError) {
        setError(logoutError instanceof Error ? logoutError.message : String(logoutError));
      } finally {
        setLogoutProviderId(null);
      }
    },
    [applyManagement, client],
  );
  const handleLogout = useCallback((providerId: string) => void logout(providerId), [logout]);
  const editAccountNote = useCallback(
    (credentialId: number) => {
      setEditingAccountId(credentialId);
      setAccountNoteDraft(accountNotes[String(credentialId)] ?? "");
      setError(null);
    },
    [accountNotes],
  );
  const cancelAccountNote = useCallback(() => {
    setEditingAccountId(null);
    setAccountNoteDraft("");
  }, []);
  const saveAccountNote = useCallback(async () => {
    if (editingAccountId === null) return;
    const nextNotes = updateOmpProviderAccountNote(
      accountNotes,
      editingAccountId,
      accountNoteDraft,
    );
    setSavingAccountNoteId(editingAccountId);
    setError(null);
    try {
      await saveOmpProviderAccountNotes(AsyncStorage, nextNotes, serverId);
      setAccountNotes(nextNotes);
      setEditingAccountId(null);
      setAccountNoteDraft("");
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : String(noteError));
    } finally {
      setSavingAccountNoteId(null);
    }
  }, [accountNoteDraft, accountNotes, editingAccountId, serverId]);

  const signInProviders = useMemo<OmpProviderSummary[]>(() => {
    if (!management) return [];
    return management.loginProviders
      .map((login) => ({
        id: login.id,
        modelCount:
          management.providerModels.find((provider) => provider.id === login.id)?.modelCount ?? 0,
        login,
      }))
      .sort((left, right) =>
        (left.login?.name ?? left.id).localeCompare(right.login?.name ?? right.id),
      );
  }, [management]);
  const customProviders = useMemo<OmpProviderSummary[]>(() => {
    if (!management) return [];
    const loginProviderIds = new Set(management.loginProviders.map((provider) => provider.id));
    return management.providerModels
      .filter((provider) => isCustomOmpProvider(provider, loginProviderIds))
      .map((provider) => ({ id: provider.id, modelCount: provider.modelCount }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }, [management]);
  const tabOptions = useMemo(
    () => [
      {
        value: "sign-in" as const,
        label: t("settings.providers.omp.tabs.signIn"),
        testID: "omp-provider-tab-sign-in",
      },
      {
        value: "custom" as const,
        label: t("settings.providers.omp.tabs.custom"),
        testID: "omp-provider-tab-custom",
      },
    ],
    [t],
  );
  const handleRefreshPress = useCallback(() => void load(), [load]);
  const handleSavePress = useCallback(() => void save(), [save]);
  const handleFinishLoginPress = useCallback(() => void finishLogin(), [finishLogin]);
  const handleOpenAuthorizationPress = useCallback(() => {
    if (loginFlow) void Linking.openURL(loginFlow.launchUrl ?? loginFlow.url);
  }, [loginFlow]);
  const providerFormHeader = useMemo<SheetHeader>(
    () => ({
      title: t(
        editingProvider
          ? "settings.providers.omp.custom.editTitle"
          : "settings.providers.omp.custom.title",
        editingProvider ? { provider: editingProvider.id } : undefined,
      ),
    }),
    [editingProvider, t],
  );
  const handleOpenAddProvider = useCallback(() => {
    setEditingProvider(null);
    setAddProviderOpen(true);
  }, []);
  const handleOpenEditProvider = useCallback(
    (providerId: string) => {
      const draft = parseCustomProviderDraft(configYaml, providerId);
      if (!draft) {
        setError(t("settings.providers.omp.custom.editLoadFailed", { provider: providerId }));
        return;
      }
      setError(null);
      setAddProviderOpen(false);
      setEditingProvider({ id: providerId, draft });
    },
    [configYaml, t],
  );
  const handleCloseProviderForm = useCallback(() => {
    setAddProviderOpen(false);
    setEditingProvider(null);
  }, []);
  const handleProviderSaved = useCallback(
    (result: OmpProviderManagement) => {
      applyManagement(result);
      setAddProviderOpen(false);
      setEditingProvider(null);
    },
    [applyManagement],
  );
  const removeProvider = useCallback(
    async (providerId: string) => {
      if (!client || removingProviderId) return;
      const confirmed = await confirmDialog({
        title: t("settings.providers.omp.custom.removeConfirmTitle", { provider: providerId }),
        message: t("settings.providers.omp.custom.removeConfirmMessage"),
        confirmLabel: t("settings.providers.omp.custom.removeProvider"),
        destructive: true,
      });
      if (!confirmed) return;

      setRemovingProviderId(providerId);
      setError(null);
      try {
        applyManagement(await client.removeOmpProvider(providerId));
      } catch (removeError) {
        setError(removeError instanceof Error ? removeError.message : String(removeError));
      } finally {
        setRemovingProviderId(null);
      }
    },
    [applyManagement, client, removingProviderId, t],
  );
  const handleRemoveProvider = useCallback(
    (providerId: string) => void removeProvider(providerId),
    [removeProvider],
  );

  if (!supported) {
    return (
      <SurfaceCard>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.omp.updateHost")}</Text>
      </SurfaceCard>
    );
  }
  if (loading && !management) {
    return (
      <View style={sheetStyles.emptyState}>
        <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{t("settings.providers.omp.loading")}</Text>
      </View>
    );
  }
  return (
    <>
      <View style={sheetStyles.managementHeader}>
        <SectionHeader title={t("settings.providers.omp.managementTitle")} />
        <Button
          variant="secondary"
          size="sm"
          leftIcon={loading ? undefined : RotateCw}
          onPress={handleRefreshPress}
          disabled={loading}
        >
          {loading ? t("settings.providers.omp.refreshing") : t("settings.providers.omp.refresh")}
        </Button>
      </View>
      {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
      {management?.runtimeError ? (
        <SurfaceCard>
          <Text style={sheetStyles.errorText}>{management.runtimeError}</Text>
        </SurfaceCard>
      ) : null}
      {management ? (
        <>
          <SegmentedControl
            options={tabOptions}
            value={activeTab}
            onValueChange={setActiveTab}
            size="sm"
            testID="omp-provider-tabs"
            style={sheetStyles.managementTabs}
          />
          {activeTab === "sign-in" ? (
            <View style={sheetStyles.tabContent}>
              {signInProviders.length > 0 ? (
                <View style={settingsStyles.card}>
                  {signInProviders.map((summary) => (
                    <OmpProviderSummaryRow
                      key={summary.id}
                      summary={summary}
                      loggingInProviderId={loginProviderId}
                      loggingOutProviderId={logoutProviderId}
                      accountNotes={accountNotes}
                      editingAccountId={editingAccountId}
                      accountNoteDraft={accountNoteDraft}
                      savingAccountNoteId={savingAccountNoteId}
                      onEditAccountNote={editAccountNote}
                      onChangeAccountNote={setAccountNoteDraft}
                      onSaveAccountNote={saveAccountNote}
                      onCancelAccountNote={cancelAccountNote}
                      onLogin={startLogin}
                      onLogout={handleLogout}
                    />
                  ))}
                </View>
              ) : (
                <SurfaceCard>
                  <Text style={sheetStyles.emptyCardText}>
                    {t("settings.providers.omp.empty.signIn")}
                  </Text>
                </SurfaceCard>
              )}
              {loginFlow ? (
                <View style={sheetStyles.section}>
                  <SectionHeader
                    title={t("settings.providers.omp.login.completeTitle", {
                      provider: loginFlow.providerId,
                    })}
                  />
                  <SurfaceCard>
                    <View style={sheetStyles.formGroup}>
                      {loginFlow.instructions ? (
                        <Text style={sheetStyles.mutedText}>{loginFlow.instructions}</Text>
                      ) : null}
                      <Text style={sheetStyles.monoHint} selectable>
                        {loginFlow.url}
                      </Text>
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={ExternalLink}
                        onPress={handleOpenAuthorizationPress}
                      >
                        {t("settings.providers.omp.login.openAuthorization")}
                      </Button>
                      <AdaptiveTextInput
                        initialValue={loginInput}
                        resetKey={loginFlow.flowId}
                        onChangeText={setLoginInput}
                        placeholder={t("settings.providers.omp.login.inputPlaceholder")}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={sheetStyles.formInput}
                      />
                      <Button
                        variant="default"
                        size="sm"
                        leftIcon={ExternalLink}
                        onPress={handleFinishLoginPress}
                        disabled={Boolean(loginProviderId)}
                      >
                        {loginProviderId
                          ? t("settings.providers.omp.login.completing")
                          : t("settings.providers.omp.login.complete")}
                      </Button>
                    </View>
                  </SurfaceCard>
                </View>
              ) : null}
            </View>
          ) : (
            <OmpCustomProvidersTab
              providers={customProviders}
              management={management}
              configYaml={configYaml}
              saving={saving}
              removingProviderId={removingProviderId}
              onOpenAddProvider={handleOpenAddProvider}
              onEditProvider={handleOpenEditProvider}
              onRemoveProvider={handleRemoveProvider}
              onConfigYamlChange={setConfigYaml}
              onSave={handleSavePress}
            />
          )}
        </>
      ) : null}
      <AdaptiveModalSheet
        header={providerFormHeader}
        visible={addProviderOpen || editingProvider !== null}
        onClose={handleCloseProviderForm}
        testID="omp-add-provider-sheet"
        snapPoints={ADD_PROVIDER_SNAP_POINTS}
        contentStyle={sheetStyles.addProviderModalContent}
      >
        {client && (addProviderOpen || editingProvider) ? (
          <OmpProviderForm
            key={editingProvider?.id ?? "add"}
            client={client}
            initialDraft={editingProvider?.draft}
            editingProviderId={editingProvider?.id}
            configYaml={editingProvider ? configYaml : undefined}
            onSaved={handleProviderSaved}
            onCancel={handleCloseProviderForm}
          />
        ) : null}
      </AdaptiveModalSheet>
    </>
  );
}

function DiagnosticSubSheet({
  provider,
  serverId,
  visible,
  onClose,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDiagnostic = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.getProviderDiagnostic(provider);
      setDiagnostic(result.diagnostic);
    } catch (err) {
      setDiagnostic(
        err instanceof Error ? err.message : t("settings.providers.diagnostic.failedToFetch"),
      );
    } finally {
      setLoading(false);
    }
  }, [client, provider, t]);

  useEffect(() => {
    if (visible) {
      void fetchDiagnostic();
    } else {
      setDiagnostic(null);
    }
  }, [visible, fetchDiagnostic]);

  const refreshButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      loading ? sheetStyles.disabled : null,
    ],
    [loading],
  );

  const handleRefreshPress = useCallback(() => {
    void fetchDiagnostic();
  }, [fetchDiagnostic]);

  const copyButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && Boolean(diagnostic) && sheetStyles.iconButtonHovered,
      diagnostic ? null : sheetStyles.disabled,
    ],
    [diagnostic],
  );

  const handleCopyPress = useCallback(() => {
    if (!diagnostic) return;
    void Clipboard.setStringAsync(diagnostic)
      .then(() => toast.copied(t("settings.providers.diagnostic.copyLabel")))
      .catch(() => toast.error(t("settings.providers.diagnostic.copyFailed")));
  }, [diagnostic, t, toast]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.providers.diagnostic.title"),
      actions: (
        <View style={sheetStyles.headerActions}>
          <Pressable
            onPress={handleCopyPress}
            disabled={!diagnostic}
            hitSlop={8}
            style={copyButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <Copy size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={
              loading
                ? t("settings.providers.diagnostic.refreshingAccessibility")
                : t("settings.providers.diagnostic.refreshAccessibility")
            }
          >
            {loading ? (
              <LoadingSpinner size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            ) : (
              <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            )}
          </Pressable>
        </View>
      ),
    }),
    [
      copyButtonStyle,
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      refreshButtonStyle,
      t,
      theme.colors.foregroundMuted,
      theme.iconSize.sm,
    ],
  );

  let body: React.ReactNode;
  if (loading && !diagnostic) {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.running")}</Text>
        </View>
      </SurfaceCard>
    );
  } else if (diagnostic) {
    body = (
      <ScrollableCodeSurface key={visible ? "visible" : "hidden"} maxHeight={480}>
        {diagnostic}
      </ScrollableCodeSurface>
    );
  } else {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.none")}</Text>
        </View>
      </SurfaceCard>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={DIAGNOSTIC_SNAP_POINTS}
      scrollable={false}
      testID="provider-diagnostic-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

interface ProviderModalBodyProps {
  discoveredCount: number;
  providerSnapshotRefreshing: boolean;
  providerErrorMessage: string | null;
  modelsRefreshing: boolean;
  searchActive: boolean;
  filteredDiscovered: AgentModelDefinition[];
  onRefresh: () => void;
  theme: { iconSize: { md: number }; colors: { foregroundMuted: string } };
}

interface ProviderSheetFooterInput {
  fetchedAtLabel: string | null;
  isCompact: boolean;
  modelsRefreshing: boolean;
  t: TFunction;
  onOpenDiagSheet: () => void;
  onRefreshModels: () => void;
}

function renderProviderSheetFooter({
  fetchedAtLabel,
  isCompact,
  modelsRefreshing,
  t,
  onOpenDiagSheet,
  onRefreshModels,
}: ProviderSheetFooterInput) {
  const contentStyle = isCompact ? sheetStyles.compactFooterContent : sheetStyles.footerContent;
  const actionsStyle = isCompact ? sheetStyles.compactFooterActions : sheetStyles.footerActions;
  const buttonStyle = isCompact ? sheetStyles.compactFooterButton : null;
  const metaStyle = isCompact
    ? [sheetStyles.footerMeta, sheetStyles.compactFooterMeta]
    : sheetStyles.footerMeta;

  return (
    <View style={contentStyle}>
      {fetchedAtLabel || !isCompact ? (
        <Text style={metaStyle} numberOfLines={1}>
          {fetchedAtLabel ? t("settings.providers.models.updated", { time: fetchedAtLabel }) : ""}
        </Text>
      ) : null}
      <View style={actionsStyle}>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={FileText}
          onPress={onOpenDiagSheet}
          style={buttonStyle}
        >
          {t("settings.providers.diagnostic.button")}
        </Button>
        <Button
          variant="default"
          size="sm"
          leftIcon={modelsRefreshing ? undefined : RotateCw}
          onPress={onRefreshModels}
          disabled={modelsRefreshing}
          style={buttonStyle}
        >
          {modelsRefreshing
            ? t("settings.providers.diagnostic.refreshing")
            : t("settings.providers.diagnostic.refresh")}
        </Button>
      </View>
    </View>
  );
}

function ProviderModalBody(props: ProviderModalBodyProps) {
  const { t } = useTranslation();
  const {
    discoveredCount,
    providerSnapshotRefreshing,
    providerErrorMessage,
    modelsRefreshing,
    searchActive,
    filteredDiscovered,
    onRefresh,
    theme,
  } = props;
  const modelGroups = useMemo(
    () => groupOmpDiscoveredModels(filteredDiscovered),
    [filteredDiscovered],
  );

  if (discoveredCount === 0 && providerSnapshotRefreshing) {
    return (
      <View style={sheetStyles.emptyState}>
        <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.loading")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && providerErrorMessage) {
    return (
      <View style={sheetStyles.emptyState}>
        <AlertTriangle size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{providerErrorMessage}</Text>
        <Button variant="default" size="sm" onPress={onRefresh} disabled={modelsRefreshing}>
          {modelsRefreshing
            ? t("settings.providers.models.retrying")
            : t("settings.providers.models.retry")}
        </Button>
      </View>
    );
  }
  if (filteredDiscovered.length === 0 && searchActive) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noSearchMatches")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noneDetected")}</Text>
      </View>
    );
  }
  return (
    <View style={sheetStyles.section}>
      <SectionHeader
        title={t("settings.providers.models.discovered")}
        count={filteredDiscovered.length}
      />
      <View style={sheetStyles.modelGroups}>
        {modelGroups.map((group) => (
          <OmpModelProviderGroup key={group.id} group={group} forceExpanded={searchActive} />
        ))}
      </View>
    </View>
  );
}

export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  serverId,
  inline = false,
}: ProviderDiagnosticSheetProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();
  const { entries: snapshotEntries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const [query, setQuery] = useState("");
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);

  const providerLabel = resolveProviderLabel(provider, snapshotEntries);
  const providerEntry = useMemo(
    () => snapshotEntries?.find((entry) => entry.provider === provider),
    [snapshotEntries, provider],
  );
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  const providerErrorMessage =
    providerEntry?.status === "error"
      ? (providerEntry.error ?? t("settings.providers.diagnostic.unknownError"))
      : null;
  const modelsRefreshing = isRefreshing || providerSnapshotRefreshing;

  const stableDiscoveredRef = useRef<ProviderDiscoveredModelsCache | null>(null);
  const currentModels = providerEntry?.models;
  const { models: discoveredModels, cache: nextDiscoveredCache } = resolveProviderDiscoveredModels({
    serverId,
    provider,
    currentModels,
    providerSnapshotRefreshing,
    previousCache: stableDiscoveredRef.current,
  });
  stableDiscoveredRef.current = nextDiscoveredCache;

  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setClockTick((tick) => tick + 1), 10_000);
    return () => clearInterval(id);
  }, [visible]);
  const fetchedAtLabel = useMemo(() => {
    if (!providerEntry?.fetchedAt) return null;
    void clockTick;
    return formatTimeAgo(new Date(providerEntry.fetchedAt));
  }, [providerEntry?.fetchedAt, clockTick]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setDiagSheetOpen(false);
    }
  }, [visible]);

  const q = query.trim();
  const filteredDiscovered = useMemo(
    () => rankModels(discoveredModels, q, (m) => [m.label, m.id, m.description ?? ""]),
    [discoveredModels, q],
  );

  const handleRefreshModels = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);

  const handleOpenDiagSheet = useCallback(() => setDiagSheetOpen(true), []);
  const handleCloseDiagSheet = useCallback(() => setDiagSheetOpen(false), []);

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: providerLabel,
      search: {
        onChange: setQuery,
        placeholder: t("settings.providers.models.searchPlaceholder"),
        testID: "provider-settings-search",
      },
    }),
    [providerLabel, t],
  );
  const content = (
    <>
      <ProviderModalBody
        discoveredCount={discoveredModels.length}
        providerSnapshotRefreshing={providerSnapshotRefreshing}
        providerErrorMessage={providerErrorMessage}
        modelsRefreshing={modelsRefreshing}
        searchActive={Boolean(q)}
        filteredDiscovered={filteredDiscovered}
        onRefresh={handleRefreshModels}
        theme={theme}
      />
      <OmpManagementPanel serverId={serverId} visible={visible} onSaved={handleRefreshModels} />
    </>
  );
  const footer = renderProviderSheetFooter({
    fetchedAtLabel,
    isCompact,
    modelsRefreshing,
    t,
    onOpenDiagSheet: handleOpenDiagSheet,
    onRefreshModels: handleRefreshModels,
  });
  const diagnostic = (
    <DiagnosticSubSheet
      provider={provider}
      serverId={serverId}
      visible={diagSheetOpen}
      onClose={handleCloseDiagSheet}
    />
  );
  if (inline) {
    return (
      <>
        <View style={sheetStyles.inlineContainer} testID="omp-provider-settings-inline">
          <AdaptiveTextInput
            initialValue={query}
            resetKey="omp-provider-inline-search"
            onChangeText={setQuery}
            placeholder={t("settings.providers.models.searchPlaceholder")}
            accessibilityLabel={t("settings.providers.models.searchPlaceholder")}
            style={sheetStyles.formInput}
          />
          {content}
          <View style={sheetStyles.inlineFooter}>{footer}</View>
        </View>
        {diagnostic}
      </>
    );
  }

  return (
    <>
      <AdaptiveModalSheet
        header={sheetHeader}
        visible={visible}
        onClose={onClose ?? NOOP}
        testID="provider-settings-sheet"
        footer={footer}
        snapPoints={MAIN_SNAP_POINTS}
      >
        {content}
      </AdaptiveModalSheet>
      {diagnostic}
    </>
  );
}

const sheetStyles = StyleSheet.create((theme) => ({
  inlineContainer: {
    gap: theme.spacing[4],
  },
  inlineFooter: {
    marginTop: theme.spacing[2],
  },
  mutedText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  monoHint: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  descriptionInline: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  formInput: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  apiSelectTrigger: {
    minHeight: 44,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  apiSelectText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontFamily: theme.fontFamily.mono,
  },
  modelList: {
    gap: theme.spacing[3],
  },
  modelGroups: {
    gap: theme.spacing[2],
  },
  modelGroupHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  modelGroupTitle: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  modelEditor: {
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
  },
  modelEditorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  modelEditorTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  modelInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[1],
  },
  modelInputMeta: {
    flex: 1,
    gap: theme.spacing[1],
  },
  modelInputHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  disabled: {
    opacity: 0.5,
  },
  section: {
    marginBottom: theme.spacing[4],
  },
  managementHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    marginBottom: theme.spacing[3],
  },
  managementTabs: {
    width: "100%",
  },
  tabContent: {
    gap: theme.spacing[4],
    marginTop: theme.spacing[3],
  },
  customProviderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  addProviderModalContent: {
    gap: theme.spacing[3],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  modelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 0,
  },
  modelRowFiller: {
    flex: 1,
  },
  providerSummaryBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  providerSummaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  providerSummaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  accountList: {
    paddingBottom: theme.spacing[2],
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    marginLeft: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  accountTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  accountNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  accountEditForm: {
    flex: 1,
    gap: theme.spacing[2],
  },
  accountNoteInput: {
    minHeight: 36,
  },
  accountEditActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  providerSummaryText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  yamlInput: {
    minHeight: 260,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  emptyState: {
    paddingVertical: theme.spacing[8],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyCardText: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  footerContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  compactFooterContent: {
    flex: 1,
    gap: theme.spacing[2],
  },
  footerMeta: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  compactFooterMeta: {
    flex: 0,
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  compactFooterActions: {
    gap: theme.spacing[2],
  },
  compactFooterButton: {
    alignSelf: "stretch",
  },
  formGroup: {
    gap: theme.spacing[3],
  },
  formColumns: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  formColumn: {
    flex: 1,
    gap: theme.spacing[2],
  },
  advancedActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  formLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  modelListActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  codeBlockLoading: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

const MAIN_SNAP_POINTS = ["65%", "92%"];
const DIAGNOSTIC_SNAP_POINTS = ["50%", "85%"];
const ADD_PROVIDER_SNAP_POINTS = ["82%", "95%"];

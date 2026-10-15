import { useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsTextArea } from "@/components/settings-textarea";
import { useToast } from "@/contexts/toast-context";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { useDesktopIpcQueryErrorToast } from "@/desktop/hooks/desktop-ipc-error";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { DraftAgentControls } from "@/composer/agent-controls";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { toErrorMessage } from "@/utils/error-messages";
import { launchDesktopPetCreation } from "./creation";
import type { DesktopPetSettings, PetCreationWorkspace, PetDescriptor, PetSize } from "./types";

const PETS_QUERY_KEY = ["desktop-pets"] as const;
const SIZES: PetSize[] = ["small", "medium", "large"];
const AUTHOR_INITIAL_VALUES = { provider: "omp" } as const;
const EXPANDED_ACCESSIBILITY_STATE = { expanded: true } as const;
const COLLAPSED_ACCESSIBILITY_STATE = { expanded: false } as const;
const fetchDesktopPets = () => invokeDesktopCommand<PetDescriptor[]>("list_desktop_pets");

export function DesktopPetSection() {
  return isElectronRuntime() ? <NativeDesktopPetSection /> : null;
}

function NativeDesktopPetSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, updateSettings, isLoading, isSaving } = useDesktopSettings();
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useStableEvent(() => setExpanded((current) => !current));
  const pets = useFetchQuery({
    queryKey: PETS_QUERY_KEY,
    queryFn: fetchDesktopPets,
    dataShape: "list",
    staleTimeMs: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useDesktopIpcQueryErrorToast({
    error: pets.error,
    message: t("desktop.pets.loadFailed"),
    logLabel: "[DesktopPet] Failed to load library",
  });
  const busy = importing || isSaving || isLoading;
  const patchPet = useStableEvent((patch: Partial<DesktopPetSettings>) => {
    void updateSettings({ pet: patch }).catch(() => {
      // The settings mutation reports its own persistence error.
    });
  });
  const setEnabled = useStableEvent((enabled: boolean) => patchPet({ enabled }));
  const setSize = useStableEvent((size: PetSize) => patchPet({ size }));
  const selectPet = useStableEvent((selectedId: string) => patchPet({ selectedId }));
  const refresh = useStableEvent(async () => {
    await pets.refetch();
  });
  const importPet = useStableEvent(async () => {
    setImporting(true);
    try {
      const directory = await getDesktopHost()?.dialog?.open?.({
        title: t("desktop.pets.importTitle"),
        directory: true,
        multiple: false,
      });
      if (typeof directory !== "string") return;
      await invokeDesktopCommand<PetDescriptor>("import_desktop_pet", { directory });
      await pets.refetch({ throwOnError: true });
      toast.show(t("desktop.pets.imported"), { variant: "success" });
    } catch (error) {
      toast.error(t("desktop.pets.importFailed", { message: toErrorMessage(error) }));
    } finally {
      setImporting(false);
    }
  });
  const trailing = useMemo(
    () => (
      <View style={styles.actions}>
        {expanded ? (
          <Button variant="ghost" size="sm" onPress={refresh} disabled={busy || pets.isFetching}>
            {pets.isFetching ? t("desktop.pets.refreshing") : t("desktop.pets.refresh")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onPress={toggleExpanded}
          leftIcon={expanded ? ChevronUp : ChevronDown}
          accessibilityState={
            expanded ? EXPANDED_ACCESSIBILITY_STATE : COLLAPSED_ACCESSIBILITY_STATE
          }
          aria-expanded={expanded}
          accessibilityLabel={t(expanded ? "desktop.pets.collapse" : "desktop.pets.expand")}
          testID="desktop-pet-settings-toggle"
        >
          {t(expanded ? "desktop.pets.collapse" : "desktop.pets.expand")}
        </Button>
      </View>
    ),
    [expanded, toggleExpanded, refresh, busy, pets.isFetching, t],
  );

  return (
    <SettingsSection title={t("desktop.pets.title")} trailing={trailing}>
      <View
        style={[settingsStyles.card, !expanded && styles.collapsed]}
        testID="desktop-pet-settings-content"
      >
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("desktop.pets.enabled")}</Text>
            <Text style={settingsStyles.rowHint}>{t("desktop.pets.enabledHint")}</Text>
          </View>
          <Switch
            value={settings.pet.enabled}
            onValueChange={setEnabled}
            disabled={busy}
            accessibilityLabel={t("desktop.pets.enabled")}
            testID="desktop-pet-enabled"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowTitle}>{t("desktop.pets.size")}</Text>
          <View style={styles.actions}>
            {SIZES.map((size) => (
              <PetSizeButton
                key={size}
                size={size}
                selected={settings.pet.size === size}
                disabled={busy}
                onSelect={setSize}
              />
            ))}
          </View>
        </View>
        <View style={[styles.library, settingsStyles.rowBorder]}>
          <View style={styles.gallery}>
            {pets.data?.map((pet) => (
              <PetCard
                key={pet.id}
                pet={pet}
                selected={settings.pet.selectedId === pet.id}
                disabled={busy}
                onSelect={selectPet}
              />
            ))}
          </View>
          {pets.data?.length === 0 ? (
            <Text style={settingsStyles.rowHint}>{t("desktop.pets.empty")}</Text>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !getDesktopHost()?.dialog?.open}
            onPress={importPet}
          >
            {importing ? t("desktop.pets.importing") : t("desktop.pets.import")}
          </Button>
        </View>
        <PetCreator disabled={busy} />
      </View>
    </SettingsSection>
  );
}

function PetSizeButton({
  size,
  selected,
  disabled,
  onSelect,
}: {
  size: PetSize;
  selected: boolean;
  disabled: boolean;
  onSelect: (size: PetSize) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useStableEvent(() => onSelect(size));
  return (
    <Button
      size="sm"
      variant={selected ? "secondary" : "ghost"}
      disabled={disabled}
      onPress={handleSelect}
    >
      {t(`desktop.pets.sizes.${size}`)}
    </Button>
  );
}

function PetCard({
  pet,
  selected,
  disabled,
  onSelect,
}: {
  pet: PetDescriptor;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useStableEvent(() => onSelect(pet.id));
  const accessibilityState = useMemo(() => ({ selected, disabled }), [selected, disabled]);
  const source = useMemo(() => ({ uri: pet.previewUrl }), [pet.previewUrl]);
  const cardStyle = useMemo(
    () => (selected ? [styles.petCard, styles.selectedCard] : styles.petCard),
    [selected],
  );
  let selectionLabel = t("desktop.pets.custom");
  if (selected) selectionLabel = t("desktop.pets.selected");
  else if (pet.builtIn) selectionLabel = t("desktop.pets.builtIn");
  return (
    <Pressable
      onPress={handleSelect}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={t("desktop.pets.selectPet", { name: pet.name })}
      style={cardStyle}
    >
      <Image
        source={source}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={styles.previewImage}
      />
      <Text style={settingsStyles.rowTitle}>{pet.name}</Text>
      <Text style={settingsStyles.rowHint} numberOfLines={2}>
        {pet.description}
      </Text>
      <Text style={styles.selection}>{selectionLabel}</Text>
    </Pressable>
  );
}

function PetCreator({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const serverId = useLocalDaemonServerId() ?? "";
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const onlineServerIds = useMemo(
    () => (connected && serverId ? [serverId] : []),
    [connected, serverId],
  );
  const authorDraft = useAgentInputDraft({
    draftKey: `desktop-pet-author:${serverId}`,
    composer: {
      initialServerId: serverId || null,
      initialValues: AUTHOR_INITIAL_VALUES,
      persistPreferences: false,
      isVisible: Boolean(serverId && connected),
      onlineServerIds,
    },
  });
  const form = authorDraft.composerState;
  const usableHost = Boolean(serverId && client && connected);
  const busy = disabled || creating;
  const ready =
    usableHost &&
    form?.selectedProvider === "omp" &&
    !form.isModelLoading &&
    !form.isAllModelsLoading &&
    !form.modelError;
  const createPet = useStableEvent(async () => {
    if (!ready || !form || !client) return;
    setCreating(true);
    try {
      const workspace = await invokeDesktopCommand<PetCreationWorkspace>(
        "prepare_desktop_pet_creation",
        { description: description.trim() },
      );
      const modeIds = form.modeOptions.map((mode) => mode.id);
      const modeId = modeIds.includes(form.selectedMode) ? form.selectedMode : modeIds[0];
      await launchDesktopPetCreation({
        serverId,
        client,
        workspace,
        preferences: {
          provider: "omp",
          ...(modeId ? { modeId } : {}),
          ...(form.effectiveModelId ? { model: form.effectiveModelId } : {}),
          ...(form.effectiveThinkingOptionId
            ? { thinkingOptionId: form.effectiveThinkingOptionId }
            : {}),
          ...(form.featureValues ? { featureValues: form.featureValues } : {}),
        },
      });
    } catch (error) {
      toast.error(t("desktop.pets.createFailed", { message: toErrorMessage(error) }));
    } finally {
      setCreating(false);
    }
  });
  let unavailable: string | null = null;
  if (!usableHost) unavailable = t("desktop.pets.noLocalHost");
  else if (!ready) unavailable = form?.modelError || t("desktop.pets.noOmpModel");
  return (
    <View style={[styles.creation, settingsStyles.rowBorder]}>
      <Text style={settingsStyles.rowTitle}>{t("desktop.pets.createTitle")}</Text>
      <Text style={settingsStyles.rowHint}>{t("desktop.pets.createHint")}</Text>
      {form ? <DraftAgentControls {...form.agentControls} disabled={busy} /> : null}
      <SettingsTextArea
        value={description}
        onChangeText={setDescription}
        placeholder={t("desktop.pets.descriptionPlaceholder")}
        accessibilityLabel={t("desktop.pets.descriptionLabel")}
        style={styles.description}
      />
      <Button variant="outline" size="sm" disabled={busy || !ready} onPress={createPet}>
        {creating ? t("desktop.pets.creating") : t("desktop.pets.create")}
      </Button>
      {unavailable ? <Text style={settingsStyles.rowHint}>{unavailable}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  collapsed: { display: "none" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  library: { padding: theme.spacing[4], gap: theme.spacing[3] },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  petCard: {
    width: 168,
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  selectedCard: { borderColor: theme.colors.foreground },
  previewImage: { width: "100%", height: 96 },
  selection: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
  creation: { padding: theme.spacing[4], gap: theme.spacing[2] },
  description: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
  },
}));

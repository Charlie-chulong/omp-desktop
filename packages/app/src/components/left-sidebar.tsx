import { router, usePathname, type Href } from "expo-router";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  CircleUserRound,
  GitBranch,
  History,
  Home,
  Import as ImportIcon,
  Plus,
  Search,
  Server,
  Settings,
  X,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { HostPicker } from "@/components/hosts/host-picker";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { ModelProviderGlyph } from "@/components/model-browser";
import {
  formatOmpAccountIdentity,
  formatOmpAccountSelectionLabel,
} from "@/components/omp-provider-accounts";
import {
  resolveOmpRemainingQuotaPct,
  shouldShowOmpFiveHourQuota,
} from "@/components/omp-provider-quota";
import { ProviderUsageBalanceBar } from "@/provider-usage/balance-bar";
import type { ProviderUsageView } from "@/provider-usage/types";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { ProviderUsageWindowBar } from "@/provider-usage/window-bar";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Shortcut } from "@/components/ui/shortcut";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveAgentControls } from "@/command-center/provider";
import {
  groupOmpModelsByProviderNamespace,
  resolveProviderSwitchModel,
  resolveModelBrowserProviderId,
  resolveModelBrowserProviderNamespaceId,
} from "@/composer/agent-controls/model-sheet-flow";
import {
  HEADER_INNER_HEIGHT,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useOpenProject } from "@/hooks/use-open-project";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import {
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import {
  type SidebarGroupMode,
  useSidebarViewStore,
} from "@/stores/sidebar-view-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useOmpAccountQuota } from "@/hooks/use-omp-account-quota";
import { usePanelStore } from "@/stores/panel-store";
import {
  useOwnsWindowChromeCorner,
  WindowChromeSafeArea,
} from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { useIsMobilePanelPresented } from "@/mobile-panels/provider";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  buildHostAgentDetailRoute,
  buildOpenProjectRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
  buildSettingsAddHostRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import { openHostOverview } from "@/navigation/settings-navigation";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

const DEV_BUILD_LABEL =
  process.env.EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL?.trim() || null;

interface SidebarSharedProps {
  theme: SidebarTheme;
  workspaceGroups: SidebarWorkspaceGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  projects: SidebarProjectEntry[];
  hasProjectsBeforeFilter: boolean;
  hasActiveProjectFilter: boolean;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleOpenImportSession: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  labels: SidebarLabels;
  newWorkspaceKeys: ShortcutKey[][] | null;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  newWorkspace: string;
  importSession: string;
  hosts: string;
  home: string;
  settings: string;
  sessions: string;
  schedules: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
  handleViewMoreNavigate: () => void;
  handleViewSchedulesNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  active: boolean;
  handleViewMore: () => void;
  handleViewSchedules: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({
  active,
}: {
  active: boolean;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const {
    projects,
    hasProjectsBeforeFilter,
    resolvedProjectFilters,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    workspaceGroups,
    projectIconTargets,
    collapsedProjectKeys,
    toggleProjectCollapsed,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const { shortcutIndexByWorkspaceKey } = shortcutModel;

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenAddProject();
  const localServerId = useLocalDaemonServerId();
  const importClient = useHostRuntimeClient(localServerId ?? "");
  const openImportedProject = useOpenProject(localServerId);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);

  const handleOpenImportSessionDesktop = useCallback(() => {
    if (!localServerId) return;
    setIsImportSheetOpen(true);
  }, [localServerId]);

  const handleOpenImportSessionMobile = useCallback(() => {
    if (!localServerId) return;
    showMobileAgent();
    setIsImportSheetOpen(true);
  }, [localServerId, showMobileAgent]);

  const handleCloseImportSession = useCallback(
    () => setIsImportSheetOpen(false),
    [],
  );

  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      if (!localServerId) return;
      void (async () => {
        const result = await openImportedProject(agent.cwd);
        if (result.ok) {
          router.push(
            buildHostAgentDetailRoute(localServerId, agent.id) as Href,
          );
        }
      })();
    },
    [localServerId, openImportedProject],
  );

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    void openProjectPicker();
  }, [showMobileAgent, openProjectPicker]);

  const handleOpenProjectDesktop = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleAddHostMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [showMobileAgent]);

  const handleAddHostDesktop = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const handleOpenHostSettingsMobile = useCallback(
    (serverId: string) => {
      showMobileAgent();
      openHostOverview(serverId);
    },
    [showMobileAgent],
  );

  const handleOpenHostSettingsDesktop = useCallback((serverId: string) => {
    openHostOverview(serverId);
  }, []);

  const handleHomeMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildOpenProjectRoute());
  }, [showMobileAgent]);

  const handleHomeDesktop = useCallback(() => {
    router.push(buildOpenProjectRoute());
  }, []);

  const handleViewMoreNavigate = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const handleViewSchedulesNavigate = useCallback(() => {
    router.push(buildSchedulesRoute());
  }, []);

  const newWorkspaceKeys = useShortcutKeys("new-workspace");
  const labels = useMemo(
    (): SidebarLabels => ({
      newWorkspace: t("sidebar.actions.newWorkspace"),
      importSession: t("importSession.title"),
      hosts: t("sidebar.actions.hosts"),
      home: t("sidebar.actions.home"),
      settings: t("sidebar.actions.settings"),
      sessions: t("sidebar.sections.sessions"),
      schedules: t("sidebar.sections.schedules"),
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    workspaceGroups,
    projectIconTargets,
    projects,
    hasProjectsBeforeFilter,
    hasActiveProjectFilter: resolvedProjectFilters.length > 0,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    labels,
    newWorkspaceKeys,
  };

  const sidebar = isCompactLayout ? (
    <RetainedPanelActivity active={active}>
      <MobileSidebar
        {...sharedProps}
        insetsTop={insets.top}
        insetsBottom={insets.bottom}
        closeSidebar={showMobileAgent}
        handleOpenProject={handleOpenProjectMobile}
        handleOpenImportSession={handleOpenImportSessionMobile}
        handleHome={handleHomeMobile}
        handleSettings={handleSettingsMobile}
        handleAddHost={handleAddHostMobile}
        handleOpenHostSettings={handleOpenHostSettingsMobile}
        handleViewMoreNavigate={handleViewMoreNavigate}
        handleViewSchedulesNavigate={handleViewSchedulesNavigate}
      />
    </RetainedPanelActivity>
  ) : (
    <RetainedPanelActivity active={active}>
      <DesktopSidebar
        {...sharedProps}
        insetsTop={insets.top}
        active={active}
        handleOpenProject={handleOpenProjectDesktop}
        handleOpenImportSession={handleOpenImportSessionDesktop}
        handleHome={handleHomeDesktop}
        handleSettings={handleSettingsDesktop}
        handleAddHost={handleAddHostDesktop}
        handleOpenHostSettings={handleOpenHostSettingsDesktop}
        handleViewMore={handleViewMoreNavigate}
        handleViewSchedules={handleViewSchedulesNavigate}
      />
    </RetainedPanelActivity>
  );

  return (
    <>
      {sidebar}
      <ImportSessionSheet
        visible={isImportSheetOpen}
        client={importClient}
        serverId={localServerId}
        onClose={handleCloseImportSession}
        onImported={handleImported}
      />
    </>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  label,
  icon: Icon,
  iconSize,
  shortcutKeys,
  theme,
}: {
  onPress: () => void;
  testID: string;
  label: string;
  icon: typeof Server;
  iconSize?: number;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
  theme: SidebarTheme;
  buttonRef?: RefObject<View | null>;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          ref={buttonRef}
          style={styles.footerIconButton}
          testID={testID}
          nativeID={testID}
          collapsable={false}
          accessible
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={onPress}
        >
          {({ hovered }) => (
            <Icon
              size={iconSize ?? theme.iconSize.md}
              color={
                hovered ? theme.colors.foreground : theme.colors.foregroundMuted
              }
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarHostPicker({
  theme,
  label,
  onAddHost,
  onOpenHostSettings,
}: {
  theme: SidebarTheme;
  label: string;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}) {
  const hosts = useHosts();
  const triggerRef = useRef<View | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      onOpenHostSettings(id);
    },
    [onOpenHostSettings],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);

  return (
    <HostPicker
      hosts={hosts}
      value=""
      onSelect={handleSelect}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopPlacement="top-start"
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      <FooterIconButton
        buttonRef={triggerRef}
        onPress={handleOpen}
        testID="sidebar-hosts-trigger"
        label={label}
        icon={Server}
        iconSize={theme.iconSize.sm}
        theme={theme}
      />
    </HostPicker>
  );
}

function IconTooltipContent({
  label,
  shortcutKeys,
}: {
  label: string;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </View>
  );
}

const SidebarNewWorkspaceHeaderRow = memo(
  function SidebarNewWorkspaceHeaderRow({
    label,
    testID,
    variant,
    shortcutKeys,
    onPress,
  }: {
    label: string;
    testID: string;
    variant: "header" | "compact";
    shortcutKeys: ShortcutKey[][] | null;
    onPress: () => void;
  }) {
    return (
      <SidebarHeaderRow
        icon={Plus}
        label={label}
        onPress={onPress}
        testID={testID}
        variant={variant}
        shortcutKeys={shortcutKeys}
      />
    );
  },
);

function SidebarQuotaMeter({
  label,
  usedPct,
  limitReached,
}: {
  label: string;
  usedPct: number | null | undefined;
  limitReached?: boolean | null;
}) {
  const { theme } = useUnistyles();
  const remainingPct = resolveOmpRemainingQuotaPct(usedPct);
  const reached = limitReached === true || remainingPct === 0;
  let color = theme.colors.foregroundMuted;
  if (reached) {
    color = theme.colors.destructive;
  } else if (remainingPct !== null && remainingPct <= 30) {
    color = theme.colors.palette.amber[500];
  } else if (remainingPct !== null) {
    color = theme.colors.palette.green[500];
  }
  const percentage =
    remainingPct === null ? "—" : `${Math.round(remainingPct)}%`;

  return (
    <View style={styles.sidebarQuotaMeter}>
      <View style={styles.sidebarQuotaHeader}>
        <Text style={styles.sidebarQuotaLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[styles.sidebarQuotaPercentage, { color }]}
          numberOfLines={1}
        >
          {percentage}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={
          remainingPct === null
            ? undefined
            : { min: 0, max: 100, now: Math.round(remainingPct) }
        }
        style={styles.sidebarQuotaTrack}
      >
        {remainingPct !== null ? (
          <View
            style={[
              styles.sidebarQuotaFill,
              { width: `${remainingPct}%`, backgroundColor: color },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}
function SidebarProviderUsageDetails({
  providerId,
  view,
  loadingLabel,
}: {
  providerId: string;
  view: ProviderUsageView;
  loadingLabel: string;
}) {
  const { t } = useTranslation();
  if (view.kind === "loading") {
    return <Text style={styles.sidebarQuotaLoading}>{loadingLabel}</Text>;
  }
  if (view.kind === "error") {
    return <Text style={styles.sidebarQuotaLoading}>{view.message}</Text>;
  }

  const usage =
    view.payload.providers.find(
      (candidate) =>
        candidate.providerId.toLowerCase() === providerId.toLowerCase(),
    ) ?? null;
  if (!usage) {
    return (
      <Text style={styles.sidebarQuotaLoading}>{t("providerUsage.empty")}</Text>
    );
  }
  if (usage.status !== "available") {
    return (
      <Text style={styles.sidebarQuotaLoading}>
        {usage.error ?? t("providerUsage.errorTitle")}
      </Text>
    );
  }

  const balances = usage.balances ?? [];
  if (usage.windows.length === 0 && balances.length === 0) {
    return (
      <Text style={styles.sidebarQuotaLoading}>{t("providerUsage.empty")}</Text>
    );
  }

  return (
    <>
      {usage.windows.map((window) => (
        <ProviderUsageWindowBar key={window.id} window={window} />
      ))}
      {balances.map((balance) => (
        <ProviderUsageBalanceBar key={balance.id} balance={balance} />
      ))}
    </>
  );
}

function SidebarProviderAccountPanel() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const active = useActiveAgentControls();
  const controls = active?.controls ?? null;
  const providerAnchorRef = useRef<View>(null);
  const accountAnchorRef = useRef<View>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const selectedModelId = controls?.models.selectedModelId ?? "";
  const providers = useMemo(
    () =>
      groupOmpModelsByProviderNamespace([
        ...(controls?.models.providers ?? []),
      ]),
    [controls?.models.providers],
  );
  const selectedProviderId = useMemo(
    () =>
      controls
        ? resolveModelBrowserProviderId(
            controls.models.selectedProvider ?? controls.provider ?? "",
            selectedModelId,
            providers,
          )
        : "",
    [controls, providers, selectedModelId],
  );
  const selectedProviderUsageId = resolveModelBrowserProviderNamespaceId(
    selectedProviderId,
    selectedModelId,
  );
  const isOmpProviderSelected =
    selectedProviderId.startsWith("omp:") || controls?.provider === "omp";
  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const rememberedModelByProviderRef = useRef(new Map<string, string>());
  const providerOptions = useMemo<ComboboxOption[]>(
    () =>
      providers.map((provider) => ({ id: provider.id, label: provider.label })),
    [providers],
  );
  useEffect(() => {
    if (!selectedProvider || !selectedModelId) return;
    if (
      selectedProvider.modelSelection.kind === "models" &&
      selectedProvider.modelSelection.rows.some(
        (row) => row.modelId === selectedModelId,
      )
    ) {
      rememberedModelByProviderRef.current.set(
        selectedProvider.id,
        selectedModelId,
      );
    }
  }, [selectedModelId, selectedProvider]);
  const accountFeature = controls?.features.list?.find(
    (feature) =>
      feature.id === "oauth_account_credential" && feature.type === "select",
  );
  const { accounts, loading } = useOmpAccountQuota(
    controls?.serverId,
    controls?.provider,
    selectedModelId,
  );
  const { view: providerUsageView, canFetch: canFetchProviderUsage } =
    useProviderUsage(controls?.serverId, {
      enabled: selectedProviderUsageId === "cursor" || isOmpProviderSelected,
      providerId: isOmpProviderSelected ? selectedProviderUsageId : undefined,
    });
  const hasSelectedProviderUsage =
    providerUsageView.kind === "ready" &&
    providerUsageView.payload.providers.some(
      (provider) =>
        provider.providerId.toLowerCase() ===
        selectedProviderUsageId.toLowerCase(),
    );
  const selectableAccounts = useMemo(() => {
    if (!accountFeature || accountFeature.type !== "select") return accounts;
    const ids = new Set(accountFeature.options.map((option) => option.id));
    return accounts.filter((account) => ids.has(String(account.credentialId)));
  }, [accountFeature, accounts]);
  const showProviderUsage =
    selectableAccounts.length === 0 &&
    canFetchProviderUsage &&
    (selectedProviderUsageId === "cursor" ||
      (isOmpProviderSelected && hasSelectedProviderUsage));
  const selectedAccountId =
    accountFeature?.type === "select"
      ? (accountFeature.effectiveValue ?? accountFeature.value ?? "")
      : "";
  const selectedAccount =
    selectableAccounts.find(
      (account) => String(account.credentialId) === selectedAccountId,
    ) ?? (selectableAccounts.length === 1 ? selectableAccounts[0] : null);
  const accountOptions = useMemo<ComboboxOption[]>(
    () =>
      selectableAccounts.map((account, index) => {
        const identity = formatOmpAccountSelectionLabel({
          note: account.note,
          identityKey: account.identityKey,
          fallback: t("agentControls.quota.account", { number: index + 1 }),
        });
        const weeklyRemaining = resolveOmpRemainingQuotaPct(
          account.quota?.weeklyUsedPct,
        );
        const fiveHourRemaining = resolveOmpRemainingQuotaPct(
          account.quota?.fiveHourUsedPct,
        );
        const quotaParts = [
          account.quota?.planLabel?.trim(),
          weeklyRemaining === null
            ? null
            : `${t("agentControls.quota.weekly")} ${Math.round(weeklyRemaining)}%`,
          shouldShowOmpFiveHourQuota(account.quota?.planLabel) &&
          fiveHourRemaining !== null
            ? `${t("agentControls.quota.fiveHour")} ${Math.round(fiveHourRemaining)}%`
            : null,
        ].filter((part): part is string => Boolean(part));
        return {
          id: String(account.credentialId),
          label: [identity, ...quotaParts].join(" · "),
        };
      }),
    [selectableAccounts, t],
  );
  const isAutomaticAccount =
    accountFeature?.type === "select" && accountFeature.value === null;
  const accountIdentity = formatOmpAccountIdentity(
    selectedAccount?.identityKey,
  );
  const accountNote = selectedAccount?.note?.trim();
  const accountSelectionLabel =
    accountNote ||
    accountIdentity.primary ||
    accountOptions.find((option) => option.id === selectedAccountId)?.label ||
    t("agentControls.features.oauthAccount.title");
  const accountPlan = selectedAccount?.quota?.planLabel?.trim();
  let accountPrimary = accountSelectionLabel;
  let accountSecondary = [
    accountNote ? null : accountIdentity.secondary,
    accountPlan,
  ]
    .filter(Boolean)
    .join(" · ");
  if (isAutomaticAccount) {
    accountPrimary = selectedAccount
      ? [t("agentControls.quota.automatic"), accountPlan]
          .filter(Boolean)
          .join(" · ")
      : t("agentControls.quota.automaticSelecting");
    accountSecondary = selectedAccount
      ? [accountSelectionLabel, accountIdentity.secondary]
          .filter(Boolean)
          .join(" · ")
      : "";
  }
  const canSwitchProvider = selectedProvider
    ? providerOptions.length > 1
    : providerOptions.length > 0;
  const hasAccountSwitcher =
    Boolean(controls?.features.set && accountFeature?.type === "select") &&
    accountOptions.length > 1;
  const canSwitchAccount = hasAccountSwitcher && controls?.isRunning !== true;

  const providerTriggerStyle = useCallback(
    ({
      hovered,
      pressed,
    }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sidebarProviderTrigger,
      (hovered || pressed || providerOpen) &&
        styles.sidebarProviderTriggerActive,
    ],
    [providerOpen],
  );
  const accountTriggerStyle = useCallback(
    ({
      hovered,
      pressed,
    }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sidebarAccountTrigger,
      (hovered || pressed || accountOpen) &&
        styles.sidebarProviderTriggerActive,
    ],
    [accountOpen],
  );
  const handleProviderSelect = useCallback(
    (providerId: string) => {
      const target = providers.find((provider) => provider.id === providerId);
      const model = target
        ? resolveProviderSwitchModel(
            target,
            rememberedModelByProviderRef.current.get(providerId),
          )
        : null;
      if (!controls || !model) return;
      void controls.models.select(model.provider, model.modelId);
      setProviderOpen(false);
    },
    [controls, providers],
  );
  const handleAccountSelect = useCallback(
    (credentialId: string) => {
      if (
        controls?.isRunning ||
        !controls?.features.set ||
        accountFeature?.type !== "select"
      ) {
        return;
      }
      void controls.features.set(accountFeature.id, credentialId);
      setAccountOpen(false);
    },
    [accountFeature, controls],
  );
  useEffect(() => {
    if (controls?.isRunning) setAccountOpen(false);
  }, [controls?.isRunning]);

  if (!controls || providers.length === 0) return null;

  return (
    <View
      style={styles.sidebarProviderCard}
      testID="sidebar-provider-account-panel"
    >
      <ComboboxTrigger
        ref={providerAnchorRef}
        collapsable={false}
        disabled={!canSwitchProvider}
        onPress={() => setProviderOpen(!providerOpen)}
        style={providerTriggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("agentControls.provider.select")}
        testID="sidebar-provider-selector"
        chevron={null}
      >
        <View style={styles.sidebarProviderIcon}>
          {selectedProvider ? (
            <ModelProviderGlyph
              provider={selectedProvider.id}
              size={18}
              tone="foreground"
            />
          ) : (
            <Bot size={18} color={theme.colors.foreground} />
          )}
        </View>
        <View style={styles.sidebarProviderCopy}>
          <Text style={styles.sidebarProviderName} numberOfLines={1}>
            {selectedProvider?.label ?? t("agentControls.provider.fallback")}
          </Text>
        </View>
        {canSwitchProvider ? (
          <ChevronDown size={14} color={theme.colors.foregroundMuted} />
        ) : null}
      </ComboboxTrigger>
      <Combobox
        options={providerOptions}
        value={selectedProviderId}
        onSelect={handleProviderSelect}
        searchable={providerOptions.length > 6}
        open={providerOpen}
        onOpenChange={setProviderOpen}
        anchorRef={providerAnchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={240}
      />

      {showProviderUsage ? (
        <>
          <View style={styles.sidebarProviderDivider} />
          <View style={styles.sidebarQuota}>
            <SidebarProviderUsageDetails
              providerId={selectedProviderUsageId}
              view={providerUsageView}
              loadingLabel={t("agentControls.quota.loading")}
            />
          </View>
        </>
      ) : null}
      {!showProviderUsage && loading && selectableAccounts.length === 0 ? (
        <View style={styles.sidebarAccountLoading}>
          <CircleUserRound size={16} color={theme.colors.foregroundMuted} />
          <Text style={styles.sidebarQuotaLoading} numberOfLines={1}>
            {t("agentControls.quota.loading")}
          </Text>
        </View>
      ) : null}
      {!showProviderUsage &&
      !(loading && selectableAccounts.length === 0) &&
      accountOptions.length > 0 ? (
        <>
          <View style={styles.sidebarProviderDivider} />
          <ComboboxTrigger
            ref={accountAnchorRef}
            collapsable={false}
            disabled={!canSwitchAccount}
            onPress={() => setAccountOpen(!accountOpen)}
            style={accountTriggerStyle}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.features.oauthAccount.title")}
            testID="sidebar-account-selector"
            chevron={null}
          >
            <CircleUserRound size={16} color={theme.colors.foregroundMuted} />
            <View style={styles.sidebarAccountCopy}>
              <Text style={styles.sidebarAccountName} numberOfLines={1}>
                {accountPrimary}
              </Text>
              {accountSecondary ? (
                <Text style={styles.sidebarAccountSecondary} numberOfLines={1}>
                  {accountSecondary}
                </Text>
              ) : null}
            </View>
            {canSwitchAccount ? (
              <ChevronDown size={14} color={theme.colors.foregroundMuted} />
            ) : null}
          </ComboboxTrigger>
          {hasAccountSwitcher && controls.isRunning ? (
            <Text style={styles.sidebarQuotaLoading}>
              {t("agentControls.quota.switchAfterTurn")}
            </Text>
          ) : null}
          <Combobox
            options={accountOptions}
            value={selectedAccountId}
            onSelect={handleAccountSelect}
            searchable={false}
            open={accountOpen}
            onOpenChange={setAccountOpen}
            anchorRef={accountAnchorRef}
            desktopPlacement="top-start"
            desktopMinWidth={240}
          />
          {selectedAccount ? (
            <View style={styles.sidebarQuota}>
              <SidebarQuotaMeter
                label={t("agentControls.quota.weekly")}
                usedPct={selectedAccount.quota?.weeklyUsedPct}
              />
              {shouldShowOmpFiveHourQuota(selectedAccount.quota?.planLabel) ? (
                <SidebarQuotaMeter
                  label={t("agentControls.quota.fiveHour")}
                  usedPct={selectedAccount.quota?.fiveHourUsedPct}
                  limitReached={selectedAccount.quota?.fiveHourLimitReached}
                />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function SidebarFooter({
  theme,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
}: {
  theme: SidebarTheme;
  handleHome: () => void;
  handleSettings: () => void;
  labels: {
    hosts: string;
    home: string;
    settings: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}) {
  const settingsKeys = useShortcutKeys("toggle-settings");

  return (
    <View style={styles.sidebarFooter}>
      <SidebarProviderAccountPanel />
      <View style={styles.footerIconRow}>
        <SidebarHostPicker
          theme={theme}
          label={labels.hosts}
          onAddHost={handleAddHost}
          onOpenHostSettings={handleOpenHostSettings}
        />
        <FooterIconButton
          onPress={handleHome}
          testID="sidebar-home"
          label={labels.home}
          icon={Home}
          theme={theme}
        />
        <FooterIconButton
          onPress={handleSettings}
          testID="sidebar-settings"
          label={labels.settings}
          icon={Settings}
          shortcutKeys={settingsKeys}
          theme={theme}
        />
      </View>
    </View>
  );
}

function MobileSidebar({
  theme,
  workspaceGroups,
  projectIconTargets,
  projects,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleOpenProject,
  handleOpenImportSession,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  closeSidebar,
  handleViewMoreNavigate,
  handleViewSchedulesNavigate,
}: MobileSidebarProps) {
  const pathname = usePathname();
  const hasActiveHostFilter = useSidebarViewStore(
    (state) => state.hostFilters.length > 0,
  );
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const { gesture: closeGesture, gestureRef: closeGestureRef } =
    useCloseAgentListGesture();
  const dragGestureHostPresented = useIsMobilePanelPresented("agent-list");

  const handleViewMore = useCallback(() => {
    closeSidebar();
    handleViewMoreNavigate();
  }, [closeSidebar, handleViewMoreNavigate]);

  const handleViewSchedules = useCallback(() => {
    closeSidebar();
    handleViewSchedulesNavigate();
  }, [closeSidebar, handleViewSchedulesNavigate]);

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <WindowChromeSafeArea placement="below" />
        <View style={styles.sidebarHeaderGroup}>
          <SidebarNewWorkspaceHeaderRow
            label={labels.newWorkspace}
            testID="sidebar-global-new-workspace"
            variant="compact"
            shortcutKeys={newWorkspaceKeys}
            onPress={handleOpenProject}
          />
          <SidebarHeaderRow
            icon={ImportIcon}
            label={labels.importSession}
            onPress={handleOpenImportSession}
            testID="sidebar-import-session"
            variant="compact"
          />
          <SidebarHeaderRow
            icon={History}
            label={labels.sessions}
            onPress={handleViewMore}
            isActive={isSessionsActive}
            testID="sidebar-sessions"
            variant="compact"
          />
          <SidebarHeaderRow
            icon={CalendarClock}
            label={labels.schedules}
            onPress={handleViewSchedules}
            isActive={isSchedulesActive}
            testID="sidebar-schedules"
            variant="compact"
          />
        </View>
        <WindowChromeSafeArea
          placement="inline"
          style={styles.mobileCloseButtonRow}
        >
          <Pressable
            style={styles.mobileCloseButton}
            onPress={closeSidebar}
            testID="sidebar-close"
            nativeID="sidebar-close"
            accessible
            accessibilityRole="button"
            accessibilityLabel={labels.closeSidebar}
            hitSlop={8}
          >
            {({ hovered, pressed }) => (
              <X
                size={theme.iconSize.md}
                color={
                  hovered || pressed
                    ? theme.colors.foreground
                    : theme.colors.foregroundMuted
                }
              />
            )}
          </Pressable>
        </WindowChromeSafeArea>

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            projects={projects}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            hasActiveProjectFilter={hasActiveProjectFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            parentGestureRef={closeGestureRef}
            dragGestureHostPresented={dragGestureHostPresented}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <SidebarFooter
          theme={theme}
          handleHome={handleHome}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />
      </View>
    </MobilePanelOverlay>
  );
}

function DesktopSidebar({
  theme,
  workspaceGroups,
  projectIconTargets,
  projects,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleOpenProject,
  handleOpenImportSession,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  active,
  handleViewMore,
  handleViewSchedules,
}: DesktopSidebarProps) {
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const pathname = usePathname();
  const hasActiveHostFilter = useSidebarViewStore(
    (state) => state.hostFilters.length > 0,
  );
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  const startWidthRef = useRef(visibleSidebarWidth);
  const resizeWidth = useSharedValue(visibleSidebarWidth);
  const [resizePressed, setResizePressed] = useState(false);
  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);

  useEffect(() => {
    resizeWidth.value = visibleSidebarWidth;
  }, [resizeWidth, visibleSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => {
          scheduleOnRN(showResizeGrip);
        })
        // Horizontal intent only, so a finger dragging down the touch grip scrolls
        // the workspace list instead of resizing. Anchoring the start width to the
        // activation translation keeps the extra threshold from jumping the edge.
        .activeOffsetX([
          -SIDEBAR_RESIZE_ACTIVATION_OFFSET,
          SIDEBAR_RESIZE_ACTIVATION_OFFSET,
        ])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidthRef.current = visibleSidebarWidth - event.translationX;
          resizeWidth.value = visibleSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          resizeWidth.value = resolveDesktopSidebarWidth({
            requestedWidth: newWidth,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        })
        .onFinalize(() => {
          scheduleOnRN(hideResizeGrip);
        }),
    [
      hideResizeGrip,
      resizeWidth,
      setSidebarWidth,
      showResizeGrip,
      viewportWidth,
      visibleSidebarWidth,
    ],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const desktopSidebarStyle = useMemo(
    () => [
      staticStyles.desktopSidebar,
      !active && staticStyles.desktopSidebarHidden,
      resizeAnimatedStyle,
    ],
    [active, resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const sidebarHeaderGroupStyle = useMemo(
    () => [
      styles.sidebarHeaderGroup,
      ownsTopLeft && styles.sidebarHeaderGroupBelowChrome,
    ],
    [ownsTopLeft],
  );
  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={desktopSidebarStyle}
    >
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          {ownsTopLeft || DEV_BUILD_LABEL ? (
            <View style={styles.desktopChromeRow}>
              <TitlebarDragRegion />
              {DEV_BUILD_LABEL ? (
                <View
                  pointerEvents="none"
                  style={styles.devBuildBadge}
                  testID="dev-build-label"
                  accessibilityLabel={`Development build: ${DEV_BUILD_LABEL}`}
                >
                  <GitBranch size={12} color={theme.colors.accentForeground} />
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={styles.devBuildBadgeText}
                  >
                    {DEV_BUILD_LABEL}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <TitlebarDragRegion />
          )}
          <View style={sidebarHeaderGroupStyle}>
            <SidebarNewWorkspaceHeaderRow
              label={labels.newWorkspace}
              testID="sidebar-global-new-workspace"
              variant="compact"
              shortcutKeys={newWorkspaceKeys}
              onPress={handleOpenProject}
            />
            <SidebarHeaderRow
              icon={ImportIcon}
              label={labels.importSession}
              onPress={handleOpenImportSession}
              testID="sidebar-import-session"
              variant="compact"
            />
            <SidebarHeaderRow
              icon={History}
              label={labels.sessions}
              onPress={handleViewMore}
              isActive={isSessionsActive}
              testID="sidebar-sessions"
              variant="compact"
            />
            <SidebarHeaderRow
              icon={CalendarClock}
              label={labels.schedules}
              onPress={handleViewSchedules}
              isActive={isSchedulesActive}
              testID="sidebar-schedules"
              variant="compact"
            />
          </View>
        </View>

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            projects={projects}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            hasActiveProjectFilter={hasActiveProjectFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <SidebarCalloutSlot />

        <SidebarFooter
          theme={theme}
          handleHome={handleHome}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        <SidebarResizeHandle
          edge="right"
          gesture={resizeGesture}
          pressed={resizePressed}
          testID="left-sidebar-resize-handle"
        />
      </View>
    </Animated.View>
  );
}

function WorkspacesSectionHeader() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const setCommandCenterOpen = useKeyboardShortcutsStore(
    (state) => state.setCommandCenterOpen,
  );
  const commandCenterKeys = useShortcutKeys("toggle-command-center");
  const handleSearchPress = useCallback(
    () => setCommandCenterOpen(true),
    [setCommandCenterOpen],
  );
  const searchButtonStyle = useCallback(
    ({
      hovered = false,
      pressed,
    }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );

  return (
    <View style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>
        {t("sidebar.sections.workspaces")}
      </Text>
      <View style={styles.workspacesSectionActions}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open command center"
              testID="sidebar-command-center-search"
              style={searchButtonStyle}
              onPress={handleSearchPress}
            >
              {({ hovered, pressed }) => (
                <Search
                  size={14}
                  color={
                    hovered || pressed
                      ? theme.colors.foreground
                      : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <IconTooltipContent
              label="Search"
              shortcutKeys={commandCenterKeys}
            />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <IconTooltipContent label="Display preferences" />
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

// Stable element so the sidebar list's listHeaderComponent prop keeps identity across
// renders (WorkspacesSectionHeader takes no props).
const workspacesSectionHeaderElement = <WorkspacesSectionHeader />;

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
  },
  desktopSidebarHidden: {
    display: "none",
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: 0,
    paddingBottom: theme.spacing[2],
    userSelect: "none",
  },
  sidebarHeaderGroupBelowChrome: {
    paddingTop: 0,
  },
  workspacesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Rendered inside the scroll's listContent (paddingHorizontal spacing[2]). The title
    // lands at spacing[2] left to align with project icons. Settings2's painted path stops
    // inside its 14px SVG, so 4px aligns the ink rather than the SVG box to the row rail.
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  workspacesSectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  workspacesSectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  workspacesHeaderIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  workspacesHeaderIconButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButtonRow: {
    position: "absolute",
    top: theme.spacing[3],
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: "flex-end",
    pointerEvents: "box-none",
  },
  mobileCloseButton: {
    // The 16px X paints farther inside its 32px hit target than the 14px Settings2 glyph.
    // This optical inset puts their painted right edges on the same sidebar rail.
    marginRight: theme.spacing[2] + 1.5,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  sidebarDragArea: {
    position: "relative",
  },
  desktopChromeRow: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
  },
  devBuildBadge: {
    maxWidth: "60%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  devBuildBadgeText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sidebarFooter: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  sidebarProviderCard: {
    width: "100%",
    overflow: "hidden",
    padding: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sidebarProviderTrigger: {
    minWidth: 0,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  sidebarProviderTriggerActive: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  sidebarProviderIcon: {
    width: 30,
    height: 30,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  sidebarProviderCopy: {
    minWidth: 0,
    flex: 1,
  },
  sidebarProviderName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  sidebarProviderDivider: {
    height: 1,
    marginHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.border,
  },
  sidebarAccountTrigger: {
    minWidth: 0,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  sidebarAccountCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  sidebarAccountName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sidebarAccountSecondary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sidebarAccountLoading: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  sidebarQuota: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  sidebarQuotaMeter: {
    gap: theme.spacing[1],
  },
  sidebarQuotaHeader: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  sidebarQuotaLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sidebarQuotaPercentage: {
    flexShrink: 0,
    textAlign: "right",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  sidebarQuotaTrack: {
    height: 4,
    overflow: "hidden",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border,
  },
  sidebarQuotaFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
  },
  sidebarQuotaLoading: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footerIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));

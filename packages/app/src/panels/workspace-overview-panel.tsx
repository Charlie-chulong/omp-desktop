import { useCallback, useEffect, useMemo, useRef } from "react";
import { FileDiff, Folder, GitBranch, MessageSquarePlus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, type PressableStateCallbackType, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { DiffStat } from "@/components/diff-stat";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { normalizeCurrentBranch } from "@/hooks/sidebar-workspaces-view-model";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { generateDraftId } from "@/stores/draft-keys";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { findPaneById, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { resolveProjectLayoutKey } from "@/workspace-tabs/project-scope";
import { openSidePanelView } from "@/workspace-tabs/side-panel";

const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedMessageSquarePlus = withUnistyles(MessageSquarePlus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const RAIL_MAX_WIDTH = 420;

function useWorkspaceOverviewDescriptor(
  target: { kind: "workspace_overview"; workspaceId: string },
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const name = useWorkspaceFields(
    context.serverId,
    target.workspaceId,
    (workspace) => workspace.name,
  );
  const subtitle = t("workspace.overview.descriptor.subtitle");
  return {
    label: name ?? t("workspace.tabs.fallback.workspace"),
    subtitle,
    tooltip: subtitle,
    titleState: "ready",
    icon: Folder,
    statusBucket: null,
  };
}

function actionStyle({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.action, hovered && styles.actionHovered, pressed && styles.actionPressed];
}

function WorkspaceOverviewPanel() {
  const { t } = useTranslation();
  const { serverId, target, isSidePanel, retargetCurrentTab } = usePaneContext();
  invariant(
    target.kind === "workspace_overview",
    "WorkspaceOverviewPanel requires overview target",
  );
  const { workspaceId } = target;
  const { isWorkspaceFocused } = usePaneFocus();
  const isActive = useRetainedPanelActive();
  const isCompact = useIsCompactFormFactor();
  const workspace = useWorkspaceFields(serverId, workspaceId, (descriptor) => ({
    name: descriptor.name,
    branch: normalizeCurrentBranch(descriptor.gitRuntime?.currentBranch),
    diffStat: descriptor.diffStat,
    cwd: descriptor.workspaceDirectory,
    isGit: descriptor.projectKind === "git",
  }));
  const checkout = useMemo<ExplorerCheckoutContext | null>(
    () =>
      workspace ? { serverId, workspaceId, cwd: workspace.cwd, isGit: workspace.isGit } : null,
    [serverId, workspace, workspaceId],
  );
  const hasChanges = Boolean(
    workspace?.diffStat && workspace.diffStat.additions + workspace.diffStat.deletions > 0,
  );

  // Its changes are the only content an empty workspace has, so they open beside the overview
  // once per tab; after that, closing the side panel sticks. Without a dedicated side pane they
  // would replace the overview, so only split layouts do this.
  const openedChangesRef = useRef(false);
  useEffect(() => {
    if (openedChangesRef.current || isCompact || !supportsDesktopPaneSplits() || isSidePanel) {
      return;
    }
    if (!isActive || !isWorkspaceFocused || !hasChanges || !checkout) return;
    const workspaceKey = resolveProjectLayoutKey({ serverId, workspaceId });
    if (!workspaceKey) return;
    openedChangesRef.current = true;
    const store = useWorkspaceLayoutStore.getState();
    const layout = store.layoutByWorkspace[workspaceKey];
    const focusedTabId = layout
      ? findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId
      : null;
    openSidePanelView({ isCompact: false, workspaceKey, checkout, view: "changes" });
    if (focusedTabId) store.focusTab(workspaceKey, focusedTabId);
  }, [
    checkout,
    hasChanges,
    isActive,
    isCompact,
    isSidePanel,
    isWorkspaceFocused,
    serverId,
    workspaceId,
  ]);

  const handleNewConversation = useCallback(() => {
    retargetCurrentTab({ kind: "draft", draftId: generateDraftId(), workspaceId });
  }, [retargetCurrentTab, workspaceId]);
  const handleViewChanges = useCallback(() => {
    openSidePanelView({
      isCompact,
      workspaceKey: resolveProjectLayoutKey({ serverId, workspaceId }),
      checkout,
      view: "changes",
    });
  }, [checkout, isCompact, serverId, workspaceId]);

  const name = workspace?.name ?? t("workspace.tabs.fallback.workspace");
  const branch = workspace?.branch && workspace.branch !== name ? workspace.branch : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="workspace-overview-panel"
    >
      <View style={styles.rail}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {name}
          </Text>
          {branch || workspace?.diffStat ? (
            <View style={styles.meta}>
              {branch ? (
                <View style={styles.metaItem}>
                  <ThemedGitBranch size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {branch}
                  </Text>
                </View>
              ) : null}
              {workspace?.diffStat ? (
                <DiffStat
                  additions={workspace.diffStat.additions}
                  deletions={workspace.diffStat.deletions}
                />
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("workspace.overview.empty.title")}</Text>
          <Text style={styles.emptyDescription}>{t("workspace.overview.empty.description")}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={handleNewConversation}
            style={actionStyle}
            testID="workspace-overview-new-conversation"
          >
            <ThemedMessageSquarePlus size={ICON_SIZE.md} uniProps={mutedColorMapping} />
            <Text style={styles.actionLabel}>
              {t("workspace.overview.actions.newConversation")}
            </Text>
          </Pressable>
          {workspace?.isGit ? (
            <Pressable
              accessibilityRole="button"
              onPress={handleViewChanges}
              style={actionStyle}
              testID="workspace-overview-view-changes"
            >
              <ThemedFileDiff size={ICON_SIZE.md} uniProps={mutedColorMapping} />
              <Text style={styles.actionLabel}>{t("workspace.overview.actions.viewChanges")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

export const workspaceOverviewPanelRegistration: PanelRegistration<"workspace_overview"> = {
  kind: "workspace_overview",
  resourceKey: (target) => target.workspaceId,
  component: WorkspaceOverviewPanel,
  useDescriptor: useWorkspaceOverviewDescriptor,
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  rail: {
    width: "100%",
    maxWidth: RAIL_MAX_WIDTH,
    gap: theme.spacing[6],
  },
  header: {
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  empty: {
    gap: theme.spacing[1],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  actions: {
    gap: theme.spacing[1],
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 44,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  actionHovered: {
    backgroundColor: theme.colors.surface2,
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionLabel: {
    color: theme.colors.foreground,
  },
}));

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useCheckoutCommitsQuery, type CheckoutCommitsQueryResult } from "@/git/use-commits-query";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import { CommitRow, COMMIT_ROW_HEIGHT } from "./commit-row";

interface CommitsSectionProps {
  serverId: string;
  cwd: string;
  currentBranchName?: string | null;
  onCommitPress: (sha: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

type LoadedCommitsQuery = Extract<
  Exclude<CheckoutCommitsQueryResult, { status: "unsupported" }>,
  { status: "loaded" }
>;
type Commit = LoadedCommitsQuery["data"]["commits"][number];

function commitKey(commit: Commit): string {
  return commit.sha;
}

function commitItemLayout(_: ArrayLike<Commit> | null | undefined, index: number) {
  return {
    length: COMMIT_ROW_HEIGHT,
    offset: COMMIT_ROW_HEIGHT * index,
    index,
  };
}

function CommitsSectionSkeleton() {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t("workspace.git.diff.commits.loading")}
      style={styles.skeleton}
      testID="commits-section-skeleton"
    >
      <View style={styles.skeletonRow}>
        <View style={styles.skeletonDot} />
        <View style={styles.skeletonSha} />
        <View style={styles.skeletonSubject} />
        <View style={styles.skeletonTimestamp} />
        <View style={styles.skeletonCaret} />
      </View>
    </View>
  );
}

function LoadedCommitsList({
  query,
  now,
  currentBranchName,
  onCommitPress,
}: {
  query: LoadedCommitsQuery;
  now: Date;
  currentBranchName?: string | null;
  onCommitPress: (sha: string) => void;
}) {
  const commits = query.data.commits;
  const renderItem = useCallback(
    ({ item: commit, index }: { item: Commit; index: number }) => (
      <CommitRow
        commit={commit}
        isFirst={index === 0}
        isLast={index === commits.length - 1}
        isContextCommit={Boolean(query.data.baseRef) && commit.isOnBase}
        branchName={index === 0 ? currentBranchName : null}
        now={now}
        onCommitPress={onCommitPress}
      />
    ),
    [commits.length, currentBranchName, now, onCommitPress, query.data.baseRef],
  );

  return (
    <FlatList
      data={commits}
      keyExtractor={commitKey}
      getItemLayout={commitItemLayout}
      renderItem={renderItem}
      extraData={`${now.getTime()}:${currentBranchName ?? ""}`}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      nestedScrollEnabled
      showsVerticalScrollIndicator
    />
  );
}

function CommitsSectionContent({
  query,
  now,
  currentBranchName,
  onCommitPress,
}: {
  query: Exclude<CheckoutCommitsQueryResult, { status: "unsupported" }>;
  now: Date;
  currentBranchName?: string | null;
  onCommitPress: (sha: string) => void;
}) {
  const { t } = useTranslation();
  if (query.status === "error") {
    return (
      <Text style={styles.errorRow} testID="commits-section-error">
        {t("workspace.git.diff.commits.loadError")}
      </Text>
    );
  }
  if (query.status !== "loaded") {
    return <CommitsSectionSkeleton />;
  }
  if (query.data.commits.length === 0) {
    return (
      <View style={styles.emptyRow} testID="commits-section-empty">
        <Text style={styles.emptyText}>{t("workspace.git.diff.commits.empty")}</Text>
      </View>
    );
  }
  return (
    <LoadedCommitsList
      query={query}
      now={now}
      currentBranchName={currentBranchName}
      onCommitPress={onCommitPress}
    />
  );
}

export function CommitsSection({
  serverId,
  cwd,
  currentBranchName,
  onCommitPress,
  collapsed = true,
  onCollapsedChange,
}: CommitsSectionProps) {
  const { t } = useTranslation();
  const isPanelActive = useRetainedPanelActive();
  const [now, setNow] = useState(() => new Date());
  const displayNow = useMemo(() => (isPanelActive ? new Date() : now), [isPanelActive, now]);
  const query = useCheckoutCommitsQuery({
    serverId,
    cwd,
    enabled: !collapsed,
  });

  const handleToggleSection = useCallback(() => {
    if (collapsed) {
      setNow(new Date());
    }
    onCollapsedChange?.(!collapsed);
  }, [collapsed, onCollapsedChange]);

  useEffect(() => {
    if (collapsed || !isPanelActive) {
      return;
    }
    const interval = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(interval);
  }, [collapsed, isPanelActive]);

  const headerChevronStyle = useMemo(
    () => [styles.headerChevron, !collapsed && styles.headerChevronExpanded],
    [collapsed],
  );

  if (query.status === "unsupported") {
    return null;
  }
  const commitCount = query.status === "loaded" ? query.data.commits.length : null;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        testID="commits-section-header"
        onPress={handleToggleSection}
        style={styles.header}
      >
        <View style={headerChevronStyle}>
          <ThemedChevron size={14} uniProps={chevronColorMapping} />
        </View>
        <Text style={styles.title}>{t("workspace.git.diff.commits.title")}</Text>
        {commitCount === null ? (
          <View style={styles.countSpacer} />
        ) : (
          <Text
            style={styles.count}
            accessibilityLabel={t("workspace.git.diff.commits.countLabel", {
              count: commitCount,
            })}
          >
            {commitCount}
          </Text>
        )}
      </Pressable>
      {collapsed ? null : (
        <CommitsSectionContent
          query={query}
          now={displayNow}
          currentBranchName={currentBranchName}
          onCommitPress={onCommitPress}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    flexShrink: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    flexShrink: 0,
  },
  headerChevron: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerChevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  title: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  count: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flex: 1,
  },
  countSpacer: {
    flex: 1,
  },
  list: {
    maxHeight: 320,
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: theme.spacing[1],
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  errorRow: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  skeleton: {
    paddingBottom: theme.spacing[1],
    gap: theme.spacing[2],
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 20,
  },
  skeletonDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  skeletonSha: {
    width: 48,
    height: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  skeletonSubject: {
    flex: 1,
    minWidth: 0,
    height: 12,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  skeletonTimestamp: {
    width: 40,
    height: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    flexShrink: 0,
  },
  skeletonCaret: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
}));

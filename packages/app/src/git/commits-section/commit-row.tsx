import React, { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { formatTimeAgo } from "@/utils/time";
import { CommitGraphNode } from "./commit-graph-node";
export const COMMIT_ROW_HEIGHT = 40;

interface CommitRowProps {
  commit: ClassifiedCheckoutCommit;
  isFirst: boolean;
  isLast: boolean;
  isContextCommit: boolean;
  branchName?: string | null;
  now: Date;
  onCommitPress: (sha: string) => void;
}

function commitRowPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowActive];
}

export const CommitRow = memo(function CommitRow({
  commit,
  isFirst,
  isLast,
  isContextCommit,
  branchName,
  now,
  onCommitPress,
}: CommitRowProps) {
  const handlePress = useCallback(() => {
    onCommitPress(commit.sha);
  }, [commit.sha, onCommitPress]);

  return (
    <Pressable
      accessibilityRole="button"
      testID={`commit-row-${commit.shortSha}`}
      onPress={handlePress}
      style={commitRowPressableStyle}
    >
      <CommitGraphNode
        commit={commit}
        isFirst={isFirst}
        isLast={isLast}
        isContextCommit={isContextCommit}
      />
      <View style={styles.commitDetails}>
        <View style={styles.summary}>
          <Text style={styles.subject} numberOfLines={1}>
            {commit.subject}
          </Text>
          {branchName ? (
            <View style={styles.branchBadge}>
              <Text style={styles.branchBadgeText} numberOfLines={1}>
                {branchName}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.metadata}>
          <Text dataSet={CODE_SURFACE_DATASET} style={styles.shortSha} numberOfLines={1}>
            {commit.shortSha}
          </Text>
          <Text style={styles.metadataSeparator}>·</Text>
          <Text style={styles.author} numberOfLines={1}>
            {commit.authorName}
          </Text>
          <Text style={styles.metadataSeparator}>·</Text>
          <Text style={styles.timestamp}>{formatTimeAgo(new Date(commit.authorDate), now)}</Text>
        </View>
      </View>
      <View style={styles.caret}>
        <ThemedChevron size={14} uniProps={chevronColorMapping} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    height: COMMIT_ROW_HEIGHT,
  },
  rowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  commitDetails: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  summary: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  subject: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  branchBadge: {
    maxWidth: 120,
    flexShrink: 1,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  branchBadgeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
  },
  metadata: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  shortSha: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  metadataSeparator: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  author: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  timestamp: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  caret: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
}));

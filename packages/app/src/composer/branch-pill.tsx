import { memo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { GitBranch } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { composerPillStyles } from "@/composer/pill-styles";
import { useVisibleWorkspaceBranch } from "@/composer/workspace-branch";
import type { Theme } from "@/styles/theme";

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedGitBranch = withUnistyles(GitBranch);

export const WorkspaceBranchPill = memo(function WorkspaceBranchPill({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement | null {
  const branch = useVisibleWorkspaceBranch(serverId, workspaceId);
  if (!branch) {
    return null;
  }

  return (
    <View style={composerPillStyles.body} testID="composer-branch-pill">
      <ThemedGitBranch size={14} uniProps={foregroundMutedIconColorMapping} />
      <Text style={composerPillStyles.label} numberOfLines={1} ellipsizeMode="tail">
        {branch}
      </Text>
    </View>
  );
});

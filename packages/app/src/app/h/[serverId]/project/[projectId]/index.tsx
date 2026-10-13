import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, usePathname } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "@react-navigation/native";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ScreenHeader } from "@/components/headers/screen-header";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useHostProjects } from "@/projects/host-projects";
import { openProjectWorkspaceDraft } from "@/utils/open-project-workspace-draft";
import { parseHostProjectRouteFromPathname } from "@/utils/host-routes";

export default function HostProjectRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <ProjectEmptyScreen />
    </HostRouteBootstrapBoundary>
  );
}

function ProjectEmptyScreen() {
  const route = usePathname();
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    projectId?: string | string[];
  }>();
  const selection = parseHostProjectRouteFromPathname(route);
  const serverId =
    selection?.serverId ?? (typeof params.serverId === "string" ? params.serverId : "");
  const projectId =
    selection?.projectId ?? (typeof params.projectId === "string" ? params.projectId : "");
  const serverIds = useMemo(() => (serverId ? [serverId] : []), [serverId]);
  const projects = useHostProjects(serverIds);
  const project = projects.find((entry) =>
    entry.hosts.some((host) => host.serverId === serverId && host.projectId === projectId),
  );
  const host = project?.hosts.find(
    (candidate) => candidate.serverId === serverId && candidate.projectId === projectId,
  );
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && typeof document !== "undefined") {
      document.title = project?.projectName ?? projectId;
    }
  }, [focused, project?.projectName, projectId]);
  const { t } = useTranslation();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const createConversation = () => {
    if (!host || creating) return;
    setCreating(true);
    void openProjectWorkspaceDraft({
      serverId,
      projectId,
      projectRootPath: host.iconWorkingDir,
    })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setCreating(false));
  };

  return (
    <View style={styles.screen} testID="project-empty-route">
      <ScreenHeader
        left={
          <>
            <SidebarMenuToggle />
            <ScreenTitle>{project?.projectName ?? projectId}</ScreenTitle>
          </>
        }
      />
      <View style={styles.content}>
        <Text style={styles.title}>{project?.projectName ?? projectId}</Text>
        <Text style={styles.description}>{t("workspace.projectEmpty.description")}</Text>
        {host ? (
          <Button
            onPress={createConversation}
            loading={creating}
            testID="project-empty-new-conversation"
          >
            {t("workspace.projectEmpty.newConversation")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[4] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

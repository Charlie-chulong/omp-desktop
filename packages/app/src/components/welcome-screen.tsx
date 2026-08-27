import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Settings } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { OmpIcon } from "@/components/icons/omp-icon";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { buildOpenProjectRoute } from "@/utils/host-routes";

function useAnyHostOnline(serverIds: string[]): boolean {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => serverIds.some((serverId) => isHostRuntimeConnected(runtime.getSnapshot(serverId))),
    () => serverIds.some((serverId) => isHostRuntimeConnected(runtime.getSnapshot(serverId))),
  );
}

export function WelcomeScreen() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const router = useRouter();
  const hosts = useHosts();
  const isLocalDaemonOnline = useAnyHostOnline(hosts.map((host) => host.serverId));

  useEffect(() => {
    if (isLocalDaemonOnline) {
      router.replace(buildOpenProjectRoute());
    }
  }, [isLocalDaemonOnline, router]);
  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);
  const settingsIcon = useMemo(
    () => <Settings size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  return (
    <View style={styles.root} testID="welcome-screen">
      <OmpIcon size={96} color={theme.colors.foreground} />
      <View style={styles.copy}>
        <Text style={styles.title}>{t("onboarding.title")}</Text>
        <Text style={styles.subtitle}>{t("onboarding.subtitle")}</Text>
      </View>
      <Text style={styles.status}>Waiting for the local OMP Desktop daemon…</Text>
      <Button variant="ghost" size="sm" onPress={handleOpenSettings} leftIcon={settingsIcon}>
        {t("onboarding.actions.settings")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  copy: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

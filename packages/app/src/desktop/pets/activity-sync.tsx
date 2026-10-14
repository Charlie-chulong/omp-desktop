import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "@/hooks/use-settings";
import { DEFAULT_UI_FONT_STACK } from "@/styles/theme";
import { getDesktopHost } from "@/desktop/host";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHosts, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { deriveDesktopPetTasks } from "./model";
import type { DesktopPetActivity } from "./types";

export function DesktopPetActivitySync() {
  return getDesktopHost()?.pet?.publishActivity ? <ConnectedDesktopPetActivitySync /> : null;
}

function ConnectedDesktopPetActivitySync() {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const fontFamily = settings.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const reportError = useDesktopIpcErrorReporter();
  const { agents } = useAggregatedAgents();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const activity = useMemo<DesktopPetActivity>(() => {
    const connectedServerIds = new Set(serverIds.filter((id) => statuses.get(id) === "online"));
    return {
      tasks: deriveDesktopPetTasks(agents, connectedServerIds, t("desktop.pets.untitledTask")),
      connected: connectedServerIds.size > 0,
      serverIds: [...connectedServerIds],
      fontFamily,
      labels: {
        idle: t("desktop.pets.activity.idle"),
        offline: t("desktop.pets.activity.offline"),
        running: t("desktop.pets.activity.running"),
        needs_input: t("desktop.pets.activity.needsInput"),
        ready: t("desktop.pets.activity.ready"),
        blocked: t("desktop.pets.activity.blocked"),
        openApp: t("desktop.pets.activity.openApp"),
        openTask: t("desktop.pets.activity.openTask"),
        hide: t("desktop.pets.activity.hide"),
        resetPosition: t("desktop.pets.activity.resetPosition"),
        taskCount: t("desktop.pets.activity.taskCount"),
      },
    };
  }, [agents, serverIds, statuses, t, fontFamily]);

  useEffect(() => {
    const publish = getDesktopHost()?.pet?.publishActivity;
    if (!publish) return;
    void publish(activity).catch((error: unknown) =>
      reportError({
        error,
        message: t("desktop.pets.activityFailed"),
        logLabel: "[DesktopPet] Failed to publish activity",
      }),
    );
  }, [activity, reportError, t]);
  return null;
}

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getIsElectron } from "@/constants/platform";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import {
  useDesktopIpcErrorReporter,
  useDesktopIpcQueryErrorToast,
} from "@/desktop/hooks/desktop-ipc-error";
import type { ReleaseChannel } from "@/hooks/use-settings";
import { i18n } from "@/i18n/i18next";
import type { DesktopBrowserTargetId } from "@/desktop/host";
import { getDesktopHost } from "@/desktop/host";
import type { DesktopPetSettings } from "@/desktop/pets/types";
import { listenToDesktopEvent } from "@/desktop/electron/events";

const DESKTOP_SETTINGS_QUERY_KEY = ["desktop-settings"] as const;

export interface DesktopSettings {
  releaseChannel: ReleaseChannel;
  browser: {
    target: DesktopBrowserTargetId;
  };
  notifications: {
    playSound: boolean;
  };
  daemon: {
    manageBuiltInDaemon: boolean;
    keepRunningAfterQuit: boolean;
  };
  pet: DesktopPetSettings;
}

export interface DesktopSettingsPatch {
  releaseChannel?: ReleaseChannel;
  browser?: Partial<DesktopSettings["browser"]>;
  notifications?: Partial<DesktopSettings["notifications"]>;
  daemon?: Partial<DesktopSettings["daemon"]>;
  pet?: Partial<DesktopPetSettings>;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  releaseChannel: "stable",
  browser: {
    target: "system",
  },
  notifications: {
    playSound: true,
  },
  daemon: {
    manageBuiltInDaemon: true,
    keepRunningAfterQuit: false,
  },
  pet: { enabled: false, size: "medium", selectedId: "iris", position: null },
};

export function useDesktopSettings(): {
  settings: DesktopSettings;
  isLoading: boolean;
  isSaving: boolean;
  error: unknown;
  updateSettings: (updates: DesktopSettingsPatch) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const reportError = useDesktopIpcErrorReporter();
  const nativeSettingsRevision = useRef(0);
  useEffect(() => {
    if (!getDesktopHost()?.events?.on) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToDesktopEvent<unknown>("desktop-settings-changed", (raw) => {
      nativeSettingsRevision.current += 1;
      void queryClient.cancelQueries({ queryKey: DESKTOP_SETTINGS_QUERY_KEY });
      queryClient.setQueryData(DESKTOP_SETTINGS_QUERY_KEY, parseDesktopSettings(raw));
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
        return undefined;
      })
      .catch((error: unknown) => {
        reportError({
          error,
          message: i18n.t("desktop.settings.loadFailed"),
          logLabel: "[DesktopSettings] Failed to subscribe to settings",
        });
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [queryClient, reportError]);
  const {
    data,
    isPending,
    error: loadError,
  } = useQuery<DesktopSettings, Error>({
    queryKey: DESKTOP_SETTINGS_QUERY_KEY,
    queryFn: loadDesktopSettings,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  useDesktopIpcQueryErrorToast({
    error: loadError,
    message: i18n.t("desktop.settings.loadFailed"),
    logLabel: "[DesktopSettings] Failed to load settings",
  });

  const { mutateAsync: saveDesktopSettings, isPending: isSaving } = useMutation<
    DesktopSettings,
    Error,
    DesktopSettingsPatch,
    DesktopSettingsMutationContext
  >({
    mutationFn: updatePersistedDesktopSettings,
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: DESKTOP_SETTINGS_QUERY_KEY });
      const previous =
        queryClient.getQueryData<DesktopSettings>(DESKTOP_SETTINGS_QUERY_KEY) ??
        DEFAULT_DESKTOP_SETTINGS;
      const revision = nativeSettingsRevision.current;
      const optimistic = queryClient.setQueryData<DesktopSettings>(
        DESKTOP_SETTINGS_QUERY_KEY,
        mergeDesktopSettings(previous, updates),
      );
      return { previous, optimistic, revision };
    },
    onSuccess: (persisted, _updates, context) => {
      if (!context || context.revision === nativeSettingsRevision.current) {
        queryClient.setQueryData<DesktopSettings>(DESKTOP_SETTINGS_QUERY_KEY, persisted);
      }
    },
    onError: (saveError, _updates, context) => {
      if (
        context &&
        context.revision === nativeSettingsRevision.current &&
        queryClient.getQueryData(DESKTOP_SETTINGS_QUERY_KEY) === context.optimistic
      ) {
        queryClient.setQueryData<DesktopSettings>(DESKTOP_SETTINGS_QUERY_KEY, context.previous);
      }
      reportError({
        error: saveError,
        message: i18n.t("desktop.settings.saveFailed"),
        logLabel: "[DesktopSettings] Failed to save settings",
      });
    },
  });

  const updateSettings = useCallback(
    async (updates: DesktopSettingsPatch) => {
      if (!getIsElectron()) {
        return;
      }

      await saveDesktopSettings(updates);
    },
    [saveDesktopSettings],
  );

  return {
    settings: data ?? DEFAULT_DESKTOP_SETTINGS,
    isLoading: isPending,
    isSaving,
    error: loadError ?? null,
    updateSettings,
  };
}

interface DesktopSettingsMutationContext {
  previous: DesktopSettings;
  optimistic: DesktopSettings | undefined;
  revision: number;
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  if (!getIsElectron()) {
    return DEFAULT_DESKTOP_SETTINGS;
  }
  return parseDesktopSettings(await invokeDesktopCommand<unknown>("get_desktop_settings"));
}

export async function updatePersistedDesktopSettings(
  updates: DesktopSettingsPatch,
): Promise<DesktopSettings> {
  if (!getIsElectron()) {
    return DEFAULT_DESKTOP_SETTINGS;
  }
  return parseDesktopSettings(
    await invokeDesktopCommand<unknown>("patch_desktop_settings", normalizePatch(updates)),
  );
}

export async function migrateLegacyDesktopSettings(input: {
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
}): Promise<void> {
  if (!getIsElectron()) {
    return;
  }
  await invokeDesktopCommand("migrate_legacy_desktop_settings", input);
}
function parsePetSettings(raw: unknown): DesktopPetSettings {
  const pet = isRecord(raw) ? raw : {};
  const position = isRecord(pet.position) ? pet.position : null;
  return {
    enabled: typeof pet.enabled === "boolean" ? pet.enabled : false,
    size: pet.size === "small" || pet.size === "large" ? pet.size : "medium",
    selectedId:
      typeof pet.selectedId === "string" && pet.selectedId.trim() ? pet.selectedId : "iris",
    position:
      position &&
      typeof position.x === "number" &&
      Number.isFinite(position.x) &&
      typeof position.y === "number" &&
      Number.isFinite(position.y)
        ? { x: position.x, y: position.y }
        : null,
  };
}

function parseDesktopSettings(raw: unknown): DesktopSettings {
  const record = isRecord(raw) ? raw : {};
  const notifications = isRecord(record.notifications) ? record.notifications : {};
  const daemon = isRecord(record.daemon) ? record.daemon : {};
  const browser = isRecord(record.browser) ? record.browser : {};

  return {
    releaseChannel: record.releaseChannel === "beta" ? "beta" : "stable",
    browser: {
      target: isDesktopBrowserTargetId(browser.target)
        ? browser.target
        : DEFAULT_DESKTOP_SETTINGS.browser.target,
    },
    notifications: {
      playSound:
        typeof notifications.playSound === "boolean"
          ? notifications.playSound
          : DEFAULT_DESKTOP_SETTINGS.notifications.playSound,
    },
    daemon: {
      manageBuiltInDaemon:
        typeof daemon.manageBuiltInDaemon === "boolean"
          ? daemon.manageBuiltInDaemon
          : DEFAULT_DESKTOP_SETTINGS.daemon.manageBuiltInDaemon,
      keepRunningAfterQuit:
        typeof daemon.keepRunningAfterQuit === "boolean"
          ? daemon.keepRunningAfterQuit
          : DEFAULT_DESKTOP_SETTINGS.daemon.keepRunningAfterQuit,
    },
    pet: parsePetSettings(record.pet),
  };
}

function mergeDesktopSettings(
  current: DesktopSettings,
  updates: DesktopSettingsPatch,
): DesktopSettings {
  return {
    releaseChannel: updates.releaseChannel ?? current.releaseChannel,
    browser: {
      ...current.browser,
      ...updates.browser,
    },
    notifications: {
      ...current.notifications,
      ...updates.notifications,
    },
    daemon: {
      ...current.daemon,
      ...updates.daemon,
    },
    pet: { ...current.pet, ...updates.pet },
  };
}

function normalizePatch(updates: DesktopSettingsPatch): Record<string, unknown> {
  return {
    ...(updates.releaseChannel ? { releaseChannel: updates.releaseChannel } : {}),
    ...(updates.browser ? { browser: updates.browser } : {}),
    ...(updates.notifications ? { notifications: updates.notifications } : {}),
    ...(updates.daemon ? { daemon: updates.daemon } : {}),
    ...(updates.pet ? { pet: updates.pet } : {}),
  };
}

function isDesktopBrowserTargetId(value: unknown): value is DesktopBrowserTargetId {
  return (
    value === "system" ||
    value === "chrome" ||
    value === "edge" ||
    value === "firefox" ||
    value === "brave" ||
    value === "chromium" ||
    value === "safari"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

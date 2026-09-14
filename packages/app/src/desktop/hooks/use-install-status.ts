import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getCliInstallStatus,
  getOmpShortcutInstallStatus,
  installCli,
  installOmpShortcut,
  shouldUseDesktopDaemon,
  type InstallStatus,
  uninstallOmpShortcut,
} from "@/desktop/daemon/desktop-daemon";
import {
  useDesktopIpcErrorReporter,
  useDesktopIpcQueryErrorToast,
} from "@/desktop/hooks/desktop-ipc-error";

const CLI_INSTALL_STATUS_QUERY_KEY = ["desktop", "integrations", "cli-install-status"] as const;
const OMP_SHORTCUT_STATUS_QUERY_KEY = ["desktop", "integrations", "omp-shortcut-status"] as const;

interface DesktopInstallHookResult {
  status: InstallStatus | null;
  isLoading: boolean;
  isInstalling: boolean;
  error: Error | null;
  install: () => void;
  refresh: () => void;
}

interface OmpShortcutInstallHookResult {
  status: InstallStatus | null;
  isInstalling: boolean;
  isUninstalling: boolean;
  install: () => void;
  uninstall: () => void;
  refresh: () => void;
}

export function useCliInstall(): DesktopInstallHookResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const reportError = useDesktopIpcErrorReporter();
  const enabled = shouldUseDesktopDaemon();

  const statusQuery = useQuery<InstallStatus, Error>({
    queryKey: CLI_INSTALL_STATUS_QUERY_KEY,
    queryFn: getCliInstallStatus,
    enabled,
    retry: false,
  });
  const { data: installStatus, error: statusError, isLoading, refetch } = statusQuery;
  useDesktopIpcQueryErrorToast({
    error: statusQuery.error,
    message: t("desktop.integrations.cli.statusFailed"),
    logLabel: "[Integrations] Failed to load CLI status",
  });

  const installMutation = useMutation<InstallStatus, Error>({
    mutationFn: installCli,
    onError: (error) => {
      reportError({
        error,
        message: t("desktop.integrations.cli.installFailed"),
        logLabel: "[Integrations] Failed to install CLI",
      });
    },
    onSuccess: (nextStatus) => {
      queryClient.setQueryData<InstallStatus>(CLI_INSTALL_STATUS_QUERY_KEY, nextStatus);
      void queryClient.invalidateQueries({ queryKey: CLI_INSTALL_STATUS_QUERY_KEY });
    },
  });
  const { error: installError, isPending: isInstalling, mutate: install } = installMutation;

  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    status: installStatus ?? null,
    isLoading,
    isInstalling,
    error: statusError ?? installError ?? null,
    install,
    refresh,
  };
}

export function useOmpShortcutInstall(): OmpShortcutInstallHookResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const reportError = useDesktopIpcErrorReporter();
  const statusQuery = useQuery<InstallStatus, Error>({
    queryKey: OMP_SHORTCUT_STATUS_QUERY_KEY,
    queryFn: getOmpShortcutInstallStatus,
    enabled: shouldUseDesktopDaemon(),
    retry: false,
  });
  const { data: installStatus, error: statusError, refetch } = statusQuery;
  useDesktopIpcQueryErrorToast({
    error: statusError,
    message: t("desktop.integrations.ompShortcut.statusFailed"),
    logLabel: "[Integrations] Failed to load OMP shortcut status",
  });

  const updateStatus = useCallback(
    (nextStatus: InstallStatus) => {
      queryClient.setQueryData<InstallStatus>(OMP_SHORTCUT_STATUS_QUERY_KEY, nextStatus);
      void queryClient.invalidateQueries({ queryKey: OMP_SHORTCUT_STATUS_QUERY_KEY });
    },
    [queryClient],
  );
  const installMutation = useMutation<InstallStatus, Error>({
    mutationFn: installOmpShortcut,
    onSuccess: updateStatus,
    onError: (error) => {
      reportError({
        error,
        message: t("desktop.integrations.ompShortcut.installFailed"),
        logLabel: "[Integrations] Failed to install OMP shortcut",
      });
    },
  });
  const uninstallMutation = useMutation<InstallStatus, Error>({
    mutationFn: uninstallOmpShortcut,
    onSuccess: updateStatus,
    onError: (error) => {
      reportError({
        error,
        message: t("desktop.integrations.ompShortcut.uninstallFailed"),
        logLabel: "[Integrations] Failed to uninstall OMP shortcut",
      });
    },
  });
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    status: installStatus ?? null,
    isInstalling: installMutation.isPending,
    isUninstalling: uninstallMutation.isPending,
    install: installMutation.mutate,
    uninstall: uninstallMutation.mutate,
    refresh,
  };
}

export type AppReleaseChannel = "stable" | "beta";
export type AppUpdateCheckIntent = "automatic" | "manual";

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string;
  latestVersion: string;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
}

export interface AppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export async function checkForAppUpdate({
  currentVersion,
}: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
  intent: AppUpdateCheckIntent;
}): Promise<AppUpdateCheckResult> {
  return {
    hasUpdate: false,
    readyToInstall: false,
    currentVersion,
    latestVersion: currentVersion,
    body: null,
    date: null,
    errorMessage: null,
  };
}

export async function downloadAndInstallUpdate(
  { currentVersion }: { currentVersion: string; releaseChannel: AppReleaseChannel },
  _onBeforeQuit?: () => Promise<void>,
): Promise<AppUpdateInstallResult> {
  return {
    installed: false,
    version: currentVersion,
    message: "Automatic updates are not configured for OMP Desktop",
  };
}

export async function installAppUpdateOnQuit(_input: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
  signal: AbortSignal;
}): Promise<boolean> {
  return false;
}

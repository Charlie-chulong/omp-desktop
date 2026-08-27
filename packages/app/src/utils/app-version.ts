import { useEffect, useState } from "react";
import { getDesktopHost } from "@/desktop/host";

import Constants from "expo-constants";
import appPackage from "../../package.json";

function toVersionOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}
interface DesktopRuntimeInfo {
  appVersion?: unknown;
}

export function resolveAppVersion(): string | null {
  const packageVersion = toVersionOrNull(appPackage?.version);
  if (packageVersion) {
    return packageVersion;
  }

  const expoVersion = toVersionOrNull(Constants.expoConfig?.version);
  if (expoVersion) {
    return expoVersion;
  }

  const manifestVersion = toVersionOrNull(
    (Constants as unknown as { manifest?: { version?: unknown } }).manifest?.version,
  );
  if (manifestVersion) {
    return manifestVersion;
  }

  return null;
}

export function useCurrentAppVersion(): string | null {
  const fallbackVersion = resolveAppVersion();
  const [version, setVersion] = useState(fallbackVersion);

  useEffect(() => {
    const invoke = getDesktopHost()?.invoke;
    if (typeof invoke !== "function") {
      return;
    }

    let active = true;
    void invoke("desktop_get_runtime_info")
      .then((runtimeInfo) => {
        const currentVersion =
          typeof runtimeInfo === "object" && runtimeInfo !== null
            ? toVersionOrNull((runtimeInfo as DesktopRuntimeInfo).appVersion)
            : null;
        if (active && currentVersion) {
          setVersion(currentVersion);
        }
      })
      .catch(() => {
        // The packaged app version remains a safe fallback when desktop IPC is unavailable.
      });

    return () => {
      active = false;
    };
  }, []);

  return version;
}

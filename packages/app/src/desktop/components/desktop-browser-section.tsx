import { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFetchQuery } from "@/data/query";
import {
  getDesktopHost,
  type DesktopBrowserTargetDescriptor,
  type DesktopBrowserTargetId,
} from "@/desktop/host";
import { useDesktopIpcQueryErrorToast } from "@/desktop/hooks/desktop-ipc-error";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

const BROWSER_TARGET_ID_LOOKUP: Record<DesktopBrowserTargetId, true> = {
  system: true,
  chrome: true,
  edge: true,
  firefox: true,
  brave: true,
  chromium: true,
  safari: true,
};

const BROWSER_FALLBACK_LABELS: Record<DesktopBrowserTargetId, string> = {
  system: "System default",
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  brave: "Brave",
  chromium: "Chromium",
  safari: "Safari",
};

const BROWSER_TARGETS_QUERY_KEY = ["desktop-browser-targets"] as const;

function isBrowserTargetDescriptor(value: unknown): value is DesktopBrowserTargetDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    typeof target.id === "string" &&
    BROWSER_TARGET_ID_LOOKUP[target.id as DesktopBrowserTargetId] === true &&
    typeof target.label === "string" &&
    target.label.trim().length > 0 &&
    typeof target.available === "boolean"
  );
}

async function loadBrowserTargets(): Promise<DesktopBrowserTargetDescriptor[]> {
  const listBrowsers = getDesktopHost()?.opener?.listBrowsers;
  if (typeof listBrowsers !== "function") {
    throw new Error("Desktop browser discovery is unavailable");
  }
  const rawTargets: unknown = await listBrowsers();
  if (!Array.isArray(rawTargets)) {
    throw new Error("Desktop browser discovery returned an invalid response");
  }

  const seen = new Set<DesktopBrowserTargetId>();
  const targets = rawTargets.filter((target): target is DesktopBrowserTargetDescriptor => {
    if (!isBrowserTargetDescriptor(target) || seen.has(target.id)) {
      return false;
    }
    seen.add(target.id);
    return true;
  });
  if (!seen.has("system")) {
    targets.unshift({ id: "system", label: BROWSER_FALLBACK_LABELS.system, available: true });
  }
  return targets;
}

function browserTargetLabel(t: TFunction, target: DesktopBrowserTargetDescriptor): string {
  if (target.id === "system") {
    return t("settings.browser.systemDefault");
  }
  if (!target.available) {
    return t("settings.browser.unavailable", { browser: target.label });
  }
  return target.label;
}

interface BrowserMenuItemProps {
  target: DesktopBrowserTargetDescriptor;
  selected: boolean;
  onSelect: (id: DesktopBrowserTargetId) => void;
}

function BrowserMenuItem({ target, selected, onSelect }: BrowserMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onSelect(target.id);
  }, [onSelect, target.id]);

  return (
    <DropdownMenuItem
      selected={selected}
      disabled={!target.available}
      onSelect={handleSelect}
      testID={`desktop-browser-option-${target.id}`}
    >
      {browserTargetLabel(t, target)}
    </DropdownMenuItem>
  );
}

function browserTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed ? styles.triggerPressed : null];
}

export function DesktopBrowserSection() {
  const { t } = useTranslation();
  const { settings, isLoading: isLoadingSettings, isSaving, updateSettings } = useDesktopSettings();
  const {
    data,
    error,
    isPending: isLoadingTargets,
  } = useFetchQuery<DesktopBrowserTargetDescriptor[], Error>({
    queryKey: BROWSER_TARGETS_QUERY_KEY,
    queryFn: loadBrowserTargets,
    dataShape: "list",
    staleTimeMs: 30_000,
    retry: false,
  });
  useDesktopIpcQueryErrorToast({
    error,
    message: t("settings.browser.loadFailed"),
    logLabel: "[DesktopBrowser] Failed to list available browsers",
  });

  const selectedTargetId = settings.browser.target;
  const targets = useMemo(() => {
    const discovered = data ?? [];
    if (discovered.some((target) => target.id === selectedTargetId)) {
      return discovered;
    }
    const selectedFallback: DesktopBrowserTargetDescriptor = {
      id: selectedTargetId,
      label: BROWSER_FALLBACK_LABELS[selectedTargetId],
      available: selectedTargetId === "system",
    };
    return selectedTargetId === "system"
      ? [selectedFallback, ...discovered]
      : [
          { id: "system", label: BROWSER_FALLBACK_LABELS.system, available: true } as const,
          selectedFallback,
          ...discovered.filter((target) => target.id !== "system"),
        ];
  }, [data, selectedTargetId]);
  const selectedTarget = targets.find((target) => target.id === selectedTargetId) ?? targets[0];
  const selectedLabel = selectedTarget
    ? browserTargetLabel(t, selectedTarget)
    : t("settings.browser.systemDefault");
  const description =
    selectedTarget && !selectedTarget.available
      ? t("settings.browser.selectedUnavailable", { browser: selectedTarget.label })
      : t("settings.browser.description");

  const handleSelect = useCallback(
    (target: DesktopBrowserTargetId) => {
      void updateSettings({ browser: { target } }).catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      });
    },
    [updateSettings],
  );

  return (
    <SettingsSection title={t("settings.browser.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.browser.openLinksWith")}</Text>
            <Text style={settingsStyles.rowHint}>{description}</Text>
          </View>
          <DropdownMenu>
            <DropdownMenuTrigger
              accessibilityRole="button"
              accessibilityLabel={t("settings.browser.accessibilityLabel", {
                browser: selectedLabel,
              })}
              disabled={isLoadingSettings || isLoadingTargets || isSaving}
              style={browserTriggerStyle}
              testID="desktop-browser-trigger"
            >
              <Text style={styles.triggerText}>{selectedLabel}</Text>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" width={220}>
              {targets.map((target) => (
                <BrowserMenuItem
                  key={target.id}
                  target={target}
                  selected={target.id === selectedTargetId}
                  onSelect={handleSelect}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));

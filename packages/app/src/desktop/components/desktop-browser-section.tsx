import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useFetchQuery } from "@/data/query";
import {
  getDesktopHost,
  type DesktopBrowserTargetDescriptor,
  type DesktopBrowserTargetId,
} from "@/desktop/host";
import { useDesktopIpcQueryErrorToast } from "@/desktop/hooks/desktop-ipc-error";
import {
  useDesktopSettings,
  type DesktopSettings,
  type DesktopSettingsPatch,
} from "@/desktop/settings/desktop-settings";
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
  custom: true,
};

const BROWSER_FALLBACK_LABELS: Record<DesktopBrowserTargetId, string> = {
  system: "System default",
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  brave: "Brave",
  chromium: "Chromium",
  safari: "Safari",
  custom: "Custom executable",
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
  if (!seen.has("custom")) {
    targets.push({ id: "custom", label: BROWSER_FALLBACK_LABELS.custom, available: true });
  }
  return targets;
}

function browserTargetLabel(t: TFunction, target: DesktopBrowserTargetDescriptor): string {
  if (target.id === "system") {
    return t("settings.browser.systemDefault");
  }
  if (target.id === "custom") {
    return t("settings.browser.custom");
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

type CustomBrowserConfig = DesktopSettings["browser"]["custom"];

interface ArgumentDraft {
  id: number;
  value: string;
}

function BrowserArgumentRow({
  argument,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  argument: ArgumentDraft;
  index: number;
  disabled: boolean;
  onChange: (id: number, value: string) => void;
  onRemove: (id: number) => void;
}) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (value: string) => onChange(argument.id, value),
    [argument.id, onChange],
  );
  const handleRemove = useCallback(() => onRemove(argument.id), [argument.id, onRemove]);
  return (
    <View style={styles.argumentRow}>
      <View style={styles.argumentInput}>
        <FormTextInput
          initialValue={argument.value}
          onChangeText={handleChange}
          editable={!disabled}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("settings.browser.argument", { index: index + 1 })}
          testID={`desktop-browser-custom-argument-${index}`}
        />
      </View>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onPress={handleRemove}
        accessibilityLabel={t("settings.browser.removeArgument", { index: index + 1 })}
        testID={`desktop-browser-custom-remove-argument-${index}`}
      >
        {t("settings.browser.remove")}
      </Button>
    </View>
  );
}

function validateCustomBrowser(custom: CustomBrowserConfig, t: TFunction): string | null {
  if (custom.executable.includes("\0") || custom.args.some((arg) => arg.includes("\0"))) {
    return t("settings.browser.nulError");
  }
  const platform = getDesktopHost()?.platform?.toLowerCase();
  const windowsPath =
    /^[a-z]:[\\/]/i.test(custom.executable) || /^\\\\[^\\]+\\[^\\]+/.test(custom.executable);
  const posixPath = custom.executable.startsWith("/");
  let absolute = windowsPath || posixPath;
  if (platform === "win32" || platform === "windows" || platform === "win") {
    absolute = windowsPath;
  } else if (
    platform === "darwin" ||
    platform === "linux" ||
    platform === "macos" ||
    platform === "mac"
  ) {
    absolute = posixPath;
  }
  if (!custom.executable.trim() || !absolute) {
    return t("settings.browser.executableError");
  }
  if (
    custom.args.filter((arg) => arg === "{url}").length !== 1 ||
    custom.args.some((arg) => arg !== "{url}" && arg.includes("{url}"))
  ) {
    return t("settings.browser.urlArgumentError");
  }
  return null;
}

function CustomBrowserForm({
  custom,
  visible,
  disabled,
  updateSettings,
}: {
  custom: CustomBrowserConfig;
  visible: boolean;
  disabled: boolean;
  updateSettings: (updates: DesktopSettingsPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const nextId = useRef(custom.args.length);
  const dirty = useRef(false);
  const [draft, setDraft] = useState(() => ({
    executable: custom.executable,
    args: custom.args.map((value, id): ArgumentDraft => ({ id, value })),
    revision: 0,
  }));
  const [error, setError] = useState<string | null>(null);
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  useEffect(() => {
    // Target-only patches and native settings events must not replace an unsaved draft.
    if (dirty.current) return;
    const args = custom.args.map((value): ArgumentDraft => ({ id: nextId.current++, value }));
    setDraft((current) => ({
      executable: custom.executable,
      args,
      revision: current.revision + 1,
    }));
  }, [custom]);

  const handleExecutableChange = useCallback((executable: string) => {
    dirty.current = true;
    setError(null);
    setDraft((current) => ({ ...current, executable }));
  }, []);
  const handleArgumentChange = useCallback((id: number, value: string) => {
    dirty.current = true;
    setError(null);
    setDraft((current) => ({
      ...current,
      args: current.args.map((arg) => (arg.id === id ? { ...arg, value } : arg)),
    }));
  }, []);
  const handleAddArgument = useCallback(() => {
    dirty.current = true;
    setError(null);
    const arg = { id: nextId.current++, value: "" };
    setDraft((current) => ({ ...current, args: [...current.args, arg] }));
  }, []);
  const handleRemoveArgument = useCallback((id: number) => {
    dirty.current = true;
    setError(null);
    setDraft((current) => ({ ...current, args: current.args.filter((arg) => arg.id !== id) }));
  }, []);
  const handleSave = useCallback(async () => {
    const submitted = { executable: draft.executable, args: draft.args.map((arg) => arg.value) };
    const validationError = validateCustomBrowser(submitted, t);
    setError(validationError);
    if (validationError) return;
    setIsSavingCustom(true);
    try {
      await updateSettings({ browser: { custom: submitted } });
      dirty.current = false;
    } catch {
      // The settings hook also reports the IPC error; retain every draft entry for retry.
      setError(t("settings.browser.customSaveFailed"));
    } finally {
      setIsSavingCustom(false);
    }
  }, [draft, t, updateSettings]);
  const formDisabled = disabled || isSavingCustom;

  if (!visible) return null;
  return (
    <View style={[styles.customForm, settingsStyles.rowBorder]}>
      <Field label={t("settings.browser.executable")} hint={t("settings.browser.executableHint")}>
        <FormTextInput
          initialValue={draft.executable}
          resetKey={draft.revision}
          onChangeText={handleExecutableChange}
          editable={!formDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("settings.browser.executable")}
          testID="desktop-browser-custom-executable"
        />
      </Field>
      <Field label={t("settings.browser.arguments")} hint={t("settings.browser.argumentsHint")}>
        {draft.args.map((arg, index) => (
          <BrowserArgumentRow
            key={arg.id}
            argument={arg}
            index={index}
            disabled={formDisabled}
            onChange={handleArgumentChange}
            onRemove={handleRemoveArgument}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={formDisabled}
          onPress={handleAddArgument}
          testID="desktop-browser-custom-add-argument"
        >
          {t("settings.browser.addArgument")}
        </Button>
      </Field>
      {error ? (
        <Text
          style={settingsStyles.rowError}
          accessibilityRole="alert"
          testID="desktop-browser-custom-error"
        >
          {error}
        </Text>
      ) : null}
      <Button
        onPress={handleSave}
        disabled={formDisabled}
        loading={isSavingCustom}
        testID="desktop-browser-custom-save"
      >
        {t("settings.browser.save")}
      </Button>
    </View>
  );
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
    const discovered = [...(data ?? [])];
    if (!discovered.some((target) => target.id === "custom")) {
      discovered.push({ id: "custom", label: BROWSER_FALLBACK_LABELS.custom, available: true });
    }
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
        <CustomBrowserForm
          custom={settings.browser.custom}
          visible={selectedTargetId === "custom"}
          disabled={isLoadingSettings || isSaving}
          updateSettings={updateSettings}
        />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  customForm: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  argumentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  argumentInput: {
    flex: 1,
    minWidth: 0,
  },
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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { pickDirectory } from "@/desktop/pick-directory";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { buildWallpaperMediaSrc } from "@/wallpaper/media-src";
import { getWallpaperSourceKey } from "@/wallpaper/source";
import { useWallpaperLoadStatus } from "@/wallpaper/load-state";
import type { WallpaperMediaDescriptor } from "@/wallpaper/types";
import {
  COLLAPSED_WALLPAPER_PREVIEW_COUNT,
  selectWallpaperPreviewFiles,
} from "./wallpaper-preview-files";

const WALLPAPER_SOURCES: readonly AppSettings["wallpaperSource"][] = ["none", "file", "url"];

const THUMB_MEDIA_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const OPACITY_SLIDER_STYLE: CSSProperties = {
  width: "100%",
  accentColor: "var(--colors-primary, #00dbe4)",
};

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function dropdownTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed ? styles.triggerPressed : null];
}

function wallpaperSourceLabel(t: TFunction, value: AppSettings["wallpaperSource"]): string {
  return t(`settings.appearance.wallpaper.source.${value}`);
}

function isWallpaperMediaDescriptor(value: unknown): value is WallpaperMediaDescriptor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.name === "string" &&
    (candidate.kind === "image" || candidate.kind === "video")
  );
}

function WallpaperThumbContent({ file }: { file: WallpaperMediaDescriptor }) {
  const src = buildWallpaperMediaSrc(file.id);
  if (file.kind === "video") {
    if (Platform.OS !== "web") return <View style={styles.wallpaperThumbPlaceholder} />;
    return <video src={src} muted playsInline preload="metadata" style={THUMB_MEDIA_STYLE} />;
  }
  if (Platform.OS !== "web") return <View style={styles.wallpaperThumbPlaceholder} />;
  return <img src={src} alt="" loading="lazy" style={THUMB_MEDIA_STYLE} />;
}

function WallpaperSourceMenuItem({
  source,
  selected,
  onSelect,
}: {
  source: AppSettings["wallpaperSource"];
  selected: boolean;
  onSelect: (source: AppSettings["wallpaperSource"]) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(source), [onSelect, source]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {wallpaperSourceLabel(t, source)}
    </DropdownMenuItem>
  );
}

function WallpaperDirectoryRow({ dir, onPick }: { dir: string | null; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel={t("settings.appearance.wallpaper.directory.pickerTitle")}
    >
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.appearance.wallpaper.directory.label")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {dir || t("settings.appearance.wallpaper.directory.hint")}
          </Text>
        </View>
        <Text style={styles.triggerText}>
          {t("settings.appearance.wallpaper.directory.browse")}
        </Text>
      </View>
    </Pressable>
  );
}

function WallpaperThumbItem({
  file,
  selected,
  onSelect,
}: {
  file: WallpaperMediaDescriptor;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(file.path), [file.path, onSelect]);
  return (
    <Pressable onPress={handlePress} accessibilityRole="button" accessibilityLabel={file.name}>
      <View style={[styles.wallpaperThumb, selected ? styles.wallpaperThumbSelected : null]}>
        <WallpaperThumbContent file={file} />
      </View>
      <Text style={styles.wallpaperThumbName} numberOfLines={1}>
        {file.name}
      </Text>
    </Pressable>
  );
}

function WallpaperPreviewGrid({
  scanning,
  files,
  selectedPath,
  onSelect,
}: {
  scanning: boolean;
  files: WallpaperMediaDescriptor[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => setExpanded(false), [files]);
  const handleExpandedToggle = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  if (scanning) {
    return (
      <View style={styles.wallpaperPreviewContainer}>
        <Text style={styles.wallpaperPreviewHint}>
          {t("settings.appearance.wallpaper.preview.scanning")}
        </Text>
      </View>
    );
  }
  if (files.length === 0) {
    return (
      <View style={styles.wallpaperPreviewContainer}>
        <Text style={styles.wallpaperPreviewHint}>
          {t("settings.appearance.wallpaper.preview.empty")}
        </Text>
      </View>
    );
  }

  const visibleFiles = selectWallpaperPreviewFiles(files, selectedPath, expanded);
  const toggleLabel = expanded
    ? t("settings.appearance.wallpaper.preview.collapse")
    : t("settings.appearance.wallpaper.preview.expand");
  const toggleText = expanded
    ? t("settings.appearance.wallpaper.preview.collapse")
    : t("settings.appearance.wallpaper.preview.expand", { count: files.length });

  return (
    <View style={styles.wallpaperPreviewContainer}>
      <View style={styles.wallpaperGrid}>
        {visibleFiles.map((file) => (
          <WallpaperThumbItem
            key={file.id}
            file={file}
            selected={selectedPath === file.path}
            onSelect={onSelect}
          />
        ))}
      </View>
      {files.length > COLLAPSED_WALLPAPER_PREVIEW_COUNT ? (
        <Pressable
          onPress={handleExpandedToggle}
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
          style={styles.wallpaperPreviewToggle}
        >
          <Text style={styles.wallpaperPreviewToggleText}>{toggleText}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function OpacitySlider({
  opacity,
  onPreview,
  onCommit,
  accessibilityLabel,
}: {
  opacity: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  accessibilityLabel: string;
}) {
  const latestValue = useRef(opacity);
  useEffect(() => {
    latestValue.current = opacity;
  }, [opacity]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.valueAsNumber / 100;
      latestValue.current = value;
      onPreview(value);
    },
    [onPreview],
  );
  const handleCommit = useCallback(() => onCommit(latestValue.current), [onCommit]);

  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={Math.round(opacity * 100)}
      aria-label={accessibilityLabel}
      style={OPACITY_SLIDER_STYLE}
      onChange={handleChange}
      onPointerUp={handleCommit}
      onKeyUp={handleCommit}
      onBlur={handleCommit}
    />
  );
}

export function WallpaperSection() {
  const { t } = useTranslation();
  const { settings, updateSettings, previewSettings } = useAppSettings();
  const [wallpaperFiles, setWallpaperFiles] = useState<WallpaperMediaDescriptor[]>([]);
  const [scanning, setScanning] = useState(false);
  const wallpaperLoadStatus = useWallpaperLoadStatus(getWallpaperSourceKey(settings));

  const handleToggle = useCallback(
    (wallpaperEnabled: boolean) => void updateSettings({ wallpaperEnabled }),
    [updateSettings],
  );
  const handleSourceChange = useCallback(
    (wallpaperSource: AppSettings["wallpaperSource"]) => void updateSettings({ wallpaperSource }),
    [updateSettings],
  );
  const handleUrlChange = useCallback(
    (wallpaperUrl: string) => void updateSettings({ wallpaperUrl: wallpaperUrl || null }),
    [updateSettings],
  );
  const handleDirPick = useCallback(async () => {
    if (!isElectronRuntime()) return;
    try {
      const wallpaperDir = await pickDirectory();
      if (wallpaperDir) {
        await updateSettings({ wallpaperDir, wallpaperPath: null });
      }
    } catch {
      // The dialog is optional and cancellation leaves the current directory unchanged.
    }
  }, [updateSettings]);
  const handleSelectWallpaper = useCallback(
    (wallpaperPath: string) => void updateSettings({ wallpaperPath }),
    [updateSettings],
  );

  useEffect(() => {
    if (
      !settings.wallpaperEnabled ||
      settings.wallpaperSource !== "file" ||
      !settings.wallpaperDir
    ) {
      setWallpaperFiles([]);
      setScanning(false);
      return;
    }

    const invoke = getDesktopHost()?.invoke;
    if (typeof invoke !== "function") {
      setWallpaperFiles([]);
      setScanning(false);
      return;
    }

    let cancelled = false;
    setScanning(true);
    setWallpaperFiles([]);
    void invoke("paseo:wallpaper:scanDir", { dir: settings.wallpaperDir })
      .then((result) => {
        if (!cancelled) {
          setWallpaperFiles(Array.isArray(result) ? result.filter(isWallpaperMediaDescriptor) : []);
        }
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setWallpaperFiles([]);
        return undefined;
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [settings.wallpaperDir, settings.wallpaperEnabled, settings.wallpaperSource]);

  const handleOpacityPreview = useCallback(
    (wallpaperOpacity: number) => previewSettings({ wallpaperOpacity }),
    [previewSettings],
  );
  const handleOpacityCommit = useCallback(
    (wallpaperOpacity: number) => void updateSettings({ wallpaperOpacity }),
    [updateSettings],
  );
  const opacity = settings.wallpaperOpacity ?? 0.85;
  const opacityPercent = Math.round(opacity * 100);
  const opacityLabel = t("settings.appearance.wallpaper.opacity.accessibilityLabel");

  return (
    <SettingsSection title={t("settings.appearance.wallpaper.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.appearance.wallpaper.enabled")}
            </Text>
          </View>
          <Switch
            value={settings.wallpaperEnabled}
            onValueChange={handleToggle}
            accessibilityLabel={t("settings.appearance.wallpaper.enabled")}
            testID="wallpaper-enabled-switch"
          />
        </View>
        {settings.wallpaperEnabled ? (
          <>
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.appearance.wallpaper.source.label")}
                </Text>
              </View>
              <DropdownMenu>
                <DropdownMenuTrigger
                  style={dropdownTriggerStyle}
                  accessibilityLabel={t("settings.appearance.wallpaper.source.label")}
                  testID="wallpaper-source-trigger"
                >
                  <Text style={styles.triggerText}>
                    {wallpaperSourceLabel(t, settings.wallpaperSource)}
                  </Text>
                  <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" width={160}>
                  {WALLPAPER_SOURCES.map((source) => (
                    <WallpaperSourceMenuItem
                      key={source}
                      source={source}
                      selected={settings.wallpaperSource === source}
                      onSelect={handleSourceChange}
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </View>

            {settings.wallpaperSource === "file" ? (
              <>
                <WallpaperDirectoryRow dir={settings.wallpaperDir} onPick={handleDirPick} />
                {settings.wallpaperDir ? (
                  <WallpaperPreviewGrid
                    scanning={scanning}
                    files={wallpaperFiles}
                    selectedPath={settings.wallpaperPath}
                    onSelect={handleSelectWallpaper}
                  />
                ) : null}
              </>
            ) : null}

            {settings.wallpaperSource === "url" ? (
              <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>
                    {t("settings.appearance.wallpaper.url.label")}
                  </Text>
                  <Text style={settingsStyles.rowHint}>
                    {t("settings.appearance.wallpaper.url.hint")}
                  </Text>
                </View>
                <TextInput
                  initialValue={settings.wallpaperUrl ?? ""}
                  onChangeText={handleUrlChange}
                  placeholder={t("settings.appearance.wallpaper.url.hint")}
                  accessibilityLabel={t("settings.appearance.wallpaper.url.accessibilityLabel")}
                  style={styles.wallpaperInput}
                  testID="wallpaper-url-input"
                />
              </View>
            ) : null}

            {wallpaperLoadStatus === "error" ? (
              <Text style={styles.wallpaperPreviewHint} accessibilityRole="alert">
                {t("settings.appearance.wallpaper.loadError")}
              </Text>
            ) : null}

            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.appearance.wallpaper.opacity.label")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.appearance.wallpaper.opacity.hint")}
                </Text>
              </View>
              <View style={styles.opacitySliderRow}>
                <View style={styles.opacitySliderContainer}>
                  {Platform.OS === "web" ? (
                    <OpacitySlider
                      opacity={opacity}
                      onPreview={handleOpacityPreview}
                      onCommit={handleOpacityCommit}
                      accessibilityLabel={opacityLabel}
                    />
                  ) : null}
                </View>
                <Text style={styles.opacityValue}>{opacityPercent}%</Text>
              </View>
            </View>
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerPressed: { opacity: 0.85 },
  triggerText: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  wallpaperInput: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "left",
  },
  opacityValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    minWidth: 48,
  },
  opacitySliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 200,
  },
  opacitySliderContainer: { flex: 1, maxWidth: 200 },
  wallpaperPreviewContainer: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  wallpaperPreviewHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
  },
  wallpaperGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  wallpaperPreviewToggle: {
    alignSelf: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  wallpaperPreviewToggleText: { color: theme.colors.primary, fontSize: theme.fontSize.sm },
  wallpaperThumb: {
    width: 96,
    height: 72,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  wallpaperThumbSelected: { borderColor: theme.colors.primary, borderWidth: 2 },
  wallpaperThumbPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.surface2,
  },
  wallpaperThumbName: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    marginTop: theme.spacing[1],
    maxWidth: 96,
    textAlign: "center",
  },
}));

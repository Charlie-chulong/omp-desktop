import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Platform } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { useAppSettings } from "@/hooks/use-settings";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { buildWallpaperMediaSrc } from "@/wallpaper/media-src";
import { setCssColorAlpha } from "@/wallpaper/color";
import { getWallpaperSourceKey, parseRemoteWallpaperSource } from "@/wallpaper/source";
import {
  beginWallpaperLoad,
  finishWallpaperLoad,
  useWallpaperLoadStatus,
} from "@/wallpaper/load-state";
import type { WallpaperMediaDescriptor, WallpaperMediaKind } from "@/wallpaper/types";

interface ResolvedWallpaperSource {
  key: string;
  src: string;
  kind: WallpaperMediaKind;
}

const LAYER_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

const MEDIA_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

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

function WallpaperBackgroundBase({ canvasColor }: { canvasColor: string }) {
  const { settings } = useAppSettings();
  const [localSource, setLocalSource] = useState<ResolvedWallpaperSource | null>(null);

  const configuredKey = getWallpaperSourceKey(settings);
  const configured = configuredKey !== null;
  const loadStatus = useWallpaperLoadStatus(configuredKey);
  const remoteSource = useMemo(() => {
    if (settings.wallpaperSource !== "url") return null;
    return parseRemoteWallpaperSource(settings.wallpaperUrl);
  }, [settings.wallpaperSource, settings.wallpaperUrl]);
  const localKey = settings.wallpaperSource === "file" ? configuredKey : null;

  useLayoutEffect(() => {
    beginWallpaperLoad(configuredKey);
    return () => beginWallpaperLoad(null);
  }, [configuredKey]);

  useEffect(() => {
    let cancelled = false;

    if (!configured || settings.wallpaperSource !== "file" || !localKey) {
      setLocalSource(null);
      return;
    }
    if (!isElectronRuntime()) {
      setLocalSource(null);
      finishWallpaperLoad(localKey, "error");
      return;
    }

    const invoke = getDesktopHost()?.invoke;
    if (typeof invoke !== "function") {
      setLocalSource(null);
      finishWallpaperLoad(localKey, "error");
      return;
    }

    setLocalSource(null);
    void invoke("paseo:wallpaper:resolveFile", {
      directory: settings.wallpaperDir,
      path: settings.wallpaperPath,
    })
      .then((result) => {
        if (cancelled) return undefined;
        if (!isWallpaperMediaDescriptor(result)) {
          finishWallpaperLoad(localKey, "error");
          return undefined;
        }
        setLocalSource({
          key: localKey,
          src: buildWallpaperMediaSrc(result.id),
          kind: result.kind,
        });
        return undefined;
      })
      .catch(() => {
        if (!cancelled) finishWallpaperLoad(localKey, "error");
        return undefined;
      });

    return () => {
      cancelled = true;
    };
  }, [
    configured,
    configuredKey,
    localKey,
    settings.wallpaperDir,
    settings.wallpaperPath,
    settings.wallpaperSource,
  ]);

  let source = remoteSource;
  if (settings.wallpaperSource !== "url") {
    source = localSource?.key === localKey ? localSource : null;
  }
  const sourceKey = source?.key ?? null;
  const opacity = Math.max(0, Math.min(1, settings.wallpaperOpacity));
  const mediaVisible = source !== null && loadStatus !== "error";
  // The selected theme remains an opaque canvas beneath the media, including
  // at 0% opacity; never fall through to the document/OS background color.
  const layerStyle = useMemo<CSSProperties>(
    () => ({ ...LAYER_STYLE, backgroundColor: canvasColor }),
    [canvasColor],
  );
  const mediaStyle = useMemo<CSSProperties>(() => ({ ...MEDIA_STYLE, opacity }), [opacity]);
  const markFailed = useCallback(() => {
    if (sourceKey) finishWallpaperLoad(sourceKey, "error");
  }, [sourceKey]);
  const markReady = useCallback(() => {
    if (sourceKey) finishWallpaperLoad(sourceKey, "ready");
  }, [sourceKey]);

  if (Platform.OS !== "web" || !configured) return null;

  return (
    <div style={layerStyle} aria-hidden="true">
      {mediaVisible && source?.kind === "video" ? (
        <video
          key={source.key}
          src={source.src}
          style={mediaStyle}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedData={markReady}
          onError={markFailed}
        />
      ) : null}
      {mediaVisible && source?.kind === "image" ? (
        <img
          key={source.key}
          src={source.src}
          alt=""
          style={mediaStyle}
          onLoad={markReady}
          onError={markFailed}
        />
      ) : null}
    </div>
  );
}

export const WallpaperBackground = withUnistyles(WallpaperBackgroundBase, (theme) => ({
  canvasColor: setCssColorAlpha(theme.colors.surface0, 1),
}));

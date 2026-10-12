import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Platform } from "react-native";
import { useAppSettings } from "@/hooks/use-settings";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { buildWallpaperMediaSrc } from "@/wallpaper/media-src";
import { isWallpaperConfigured, parseRemoteWallpaperSource } from "@/wallpaper/source";
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

export function WallpaperBackground() {
  const { settings } = useAppSettings();
  const [localSource, setLocalSource] = useState<ResolvedWallpaperSource | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const configured = isWallpaperConfigured(settings);
  const remoteSource = useMemo(() => {
    if (settings.wallpaperSource !== "url") return null;
    return parseRemoteWallpaperSource(settings.wallpaperUrl);
  }, [settings.wallpaperSource, settings.wallpaperUrl]);
  const localKey =
    settings.wallpaperSource === "file" && settings.wallpaperDir && settings.wallpaperPath
      ? `file:${settings.wallpaperDir}:${settings.wallpaperPath}`
      : null;

  useEffect(() => {
    let cancelled = false;
    setFailedKey(null);

    if (!configured || settings.wallpaperSource !== "file" || !localKey) {
      setLocalSource(null);
      return;
    }
    if (!isElectronRuntime()) {
      setLocalSource(null);
      setFailedKey(localKey);
      return;
    }

    const invoke = getDesktopHost()?.invoke;
    if (typeof invoke !== "function") {
      setLocalSource(null);
      setFailedKey(localKey);
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
          setFailedKey(localKey);
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
        if (!cancelled) setFailedKey(localKey);
        return undefined;
      });

    return () => {
      cancelled = true;
    };
  }, [
    configured,
    localKey,
    settings.wallpaperDir,
    settings.wallpaperPath,
    settings.wallpaperSource,
  ]);

  const source = settings.wallpaperSource === "url" ? remoteSource : localSource;
  const sourceKey = source?.key ?? null;
  const opacity = Math.max(0, Math.min(1, settings.wallpaperOpacity));
  const mediaVisible = source !== null && source.key !== failedKey;
  const layerStyle = useMemo<CSSProperties>(() => ({ ...LAYER_STYLE, opacity }), [opacity]);
  const markFailed = useCallback(() => {
    if (sourceKey) setFailedKey(sourceKey);
  }, [sourceKey]);

  if (Platform.OS !== "web" || !configured) return null;

  return (
    <div style={layerStyle} aria-hidden="true">
      {mediaVisible && source?.kind === "video" ? (
        <video
          key={source.key}
          src={source.src}
          style={MEDIA_STYLE}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onError={markFailed}
        />
      ) : null}
      {mediaVisible && source?.kind === "image" ? (
        <img key={source.key} src={source.src} alt="" style={MEDIA_STYLE} onError={markFailed} />
      ) : null}
    </div>
  );
}

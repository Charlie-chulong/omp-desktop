import { useSyncExternalStore } from "react";

export type WallpaperLoadStatus = "loading" | "ready" | "error";

let currentKey: string | null = null;
let currentStatus: WallpaperLoadStatus = "loading";
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function beginWallpaperLoad(key: string | null): void {
  currentKey = key;
  currentStatus = "loading";
  notify();
}

export function finishWallpaperLoad(key: string, status: "ready" | "error"): void {
  // A media event from a replaced element must not change the current wallpaper.
  if (currentKey !== key || currentStatus === status) return;
  currentStatus = status;
  notify();
}

export function getWallpaperLoadStatus(key: string | null): WallpaperLoadStatus {
  return key !== null && key === currentKey ? currentStatus : "loading";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWallpaperLoadStatus(key: string | null): WallpaperLoadStatus {
  return useSyncExternalStore(
    subscribe,
    () => getWallpaperLoadStatus(key),
    () => "loading",
  );
}

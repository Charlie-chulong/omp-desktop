import { useEffect, useState } from "react";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";

// A touch tablet running the desktop layout is still `isWeb === false || true`
// depending on the build, so neither platform gate answers "can this user
// hover and point precisely". Only the media query does.
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const COARSE_POINTER_QUERY = "(any-pointer: coarse)";

function getPointerQueryList(query: string): MediaQueryList | null {
  if (!isWeb || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(query);
}

/** True when a mouse-like pointer drives the UI. Always false on native. */
export function hasFinePointer(): boolean {
  return getPointerQueryList(FINE_POINTER_QUERY)?.matches ?? false;
}

/**
 * Reactive `hasFinePointer()` — re-renders when the user switches between a
 * mouse and touch (detachable keyboards, tablet mode).
 */
export function useHasFinePointer(): boolean {
  const [finePointer, setFinePointer] = useState(hasFinePointer);

  useEffect(() => {
    const mediaQuery = getPointerQueryList(FINE_POINTER_QUERY);
    if (!mediaQuery) return;
    const handleChange = () => setFinePointer(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener?.("change", handleChange);
    return () => {
      mediaQuery.removeEventListener?.("change", handleChange);
    };
  }, []);

  return finePointer;
}

/** Includes hybrid devices with both touch and a fine mouse pointer. */
export function useHasCoarsePointer(): boolean {
  const [coarsePointer, setCoarsePointer] = useState(
    () => getPointerQueryList(COARSE_POINTER_QUERY)?.matches ?? false,
  );

  useEffect(() => {
    const mediaQuery = getPointerQueryList(COARSE_POINTER_QUERY);
    if (!mediaQuery) return;
    const handleChange = () => setCoarsePointer(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, []);

  return coarsePointer;
}

/** Stable action affordances for touch, keyboard-only, and compact layouts. */
export function useShowPersistentActions(): boolean {
  const compact = useIsCompactFormFactor();
  const finePointer = useHasFinePointer();
  const coarsePointer = useHasCoarsePointer();
  return compact || !finePointer || coarsePointer;
}

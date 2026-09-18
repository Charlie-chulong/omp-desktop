import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { OpenProjectResult } from "@/hooks/open-project";
import { useToast } from "@/contexts/toast-context";
import { getDesktopHost } from "@/desktop/host";
import { createDroppedItems } from "@/components/file-drop/desktop-dropped-items";
import { droppedDirectoryPaths } from "@/components/sidebar-project-drop";

const DROP_OWNER_DATASET = { "file-drop-owner": "project" };

interface SidebarProjectDropZoneProps {
  children: ReactNode;
  disabled: boolean;
  localServerId: string | null;
  hint: string;
  failedMessage: string;
  openProject: (path: string) => Promise<OpenProjectResult>;
  style?: StyleProp<ViewStyle>;
}

export function SidebarProjectDropZone({
  children,
  disabled,
  localServerId,
  hint,
  failedMessage,
  openProject,
  style,
}: SidebarProjectDropZoneProps) {
  const toast = useToast();
  const containerRef = useRef<HTMLElement | null>(null);
  const dragDepthRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const canAccept = (event: DragEvent) =>
      !disabled &&
      Boolean(localServerId) &&
      Boolean(getDesktopHost()?.webUtils?.getPathForFile) &&
      (event.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canAccept(event)) return;
      dragDepthRef.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.dataTransfer) return;
      event.dataTransfer.dropEffect = canAccept(event) ? "copy" : "none";
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDragging(false);
      if (!canAccept(event)) return;

      const getPathForFile = getDesktopHost()?.webUtils?.getPathForFile;
      if (!getPathForFile) return;
      const paths = droppedDirectoryPaths(
        createDroppedItems({
          files: Array.from(event.dataTransfer?.files ?? []),
          transferItems: Array.from(event.dataTransfer?.items ?? []).filter(
            (item) => item.kind === "file",
          ),
          getPathForFile,
        }),
      );
      for (const path of paths) {
        void openProject(path)
          .then((result) => {
            if (!result.ok) toast.error(result.error || failedMessage);
            return undefined;
          })
          .catch((error) => {
            toast.error(error instanceof Error && error.message ? error.message : failedMessage);
          });
      }
    };

    element.addEventListener("dragenter", onDragEnter);
    element.addEventListener("dragover", onDragOver);
    element.addEventListener("dragleave", onDragLeave);
    element.addEventListener("drop", onDrop);
    return () => {
      element.removeEventListener("dragenter", onDragEnter);
      element.removeEventListener("dragover", onDragOver);
      element.removeEventListener("dragleave", onDragLeave);
      element.removeEventListener("drop", onDrop);
    };
  }, [disabled, failedMessage, localServerId, openProject, toast]);

  return (
    <View
      ref={containerRef as unknown as RefObject<View>}
      style={style}
      dataSet={DROP_OWNER_DATASET}
    >
      {children}
      {dragging ? (
        <View pointerEvents="none" style={styles.overlay} testID="sidebar-project-drop-hint">
          <Text style={styles.hint}>{hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    ...RNStyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: "center",
    justifyContent: "center",
    margin: theme.spacing[2],
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.colors.accent,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background,
    opacity: 0.96,
  },
  hint: {
    maxWidth: 180,
    paddingHorizontal: theme.spacing[4],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textAlign: "center",
  },
}));

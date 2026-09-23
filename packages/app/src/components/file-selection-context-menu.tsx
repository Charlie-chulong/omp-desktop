import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { ClipboardPaste, Copy, ListChecks, Scissors, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ui/context-menu";
import { isWeb } from "@/constants/platform";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";

const copyIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface FileSelectionRange {
  startLine: number;
  endLine: number;
}

export type FileSelectionTextCommand = "copy" | "cut" | "paste" | "selectAll";

export function getFileSelectionRange(input: {
  from: number;
  to: number;
  lineAt(position: number): { number: number; from: number };
}): FileSelectionRange | null {
  if (input.from === input.to) return null;
  const from = Math.min(input.from, input.to);
  const to = Math.max(input.from, input.to);
  return {
    startLine: input.lineAt(from).number,
    endLine: input.lineAt(Math.max(from, to - 1)).number,
  };
}

interface FileSelectionContextMenuProps {
  children: ReactNode;
  path: string;
  workspaceRoot: string;
  selection: FileSelectionRange | null;
  editable?: boolean;
  onTextCommand?: (command: FileSelectionTextCommand) => void | Promise<void>;
}

interface WebContextMenuEvent {
  nativeEvent: { pageX: number; pageY: number };
  preventDefault(): void;
  stopPropagation(): void;
}

export function formatFileSelectionReference(input: {
  path: string;
  workspaceRoot: string;
  selection: FileSelectionRange;
  absolute: boolean;
}): string | null {
  const resolved = resolveWorkspaceFilePaths({
    path: input.path,
    workspaceRoot: input.workspaceRoot,
  });
  const filePath = input.absolute ? resolved?.absolutePath : resolved?.relativePath;
  if (!filePath) return null;
  return `${input.absolute ? "@" : ""}${filePath}#L${input.selection.startLine}-${input.selection.endLine}`;
}

function FileSelectionContextTarget({
  children,
  selection,
  absoluteReference,
  relativeReference,
}: {
  children: ReactNode;
  selection: FileSelectionRange | null;
  absoluteReference: string | null;
  relativeReference: string | null;
}) {
  const contextMenu = useContextMenu();
  const handleContextMenu = useCallback(
    (event: WebContextMenuEvent) => {
      if (!isWeb || !selection || (!absoluteReference && !relativeReference)) return;
      event.preventDefault();
      event.stopPropagation();
      contextMenu.setAnchorRect({
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
        width: 0,
        height: 0,
      });
      contextMenu.setOpen(true);
    },
    [absoluteReference, contextMenu, relativeReference, selection],
  );

  return (
    <View
      // @ts-expect-error onContextMenu is available on React Native Web.
      onContextMenu={handleContextMenu}
      style={styles.target}
      testID="file-selection-context-target"
    >
      {children}
    </View>
  );
}

export function FileSelectionContextMenu({
  children,
  path,
  workspaceRoot,
  selection,
  editable = false,
  onTextCommand,
}: FileSelectionContextMenuProps) {
  const { t } = useTranslation();
  const absoluteReference = selection
    ? formatFileSelectionReference({ path, workspaceRoot, selection, absolute: true })
    : null;
  const relativeReference = selection
    ? formatFileSelectionReference({ path, workspaceRoot, selection, absolute: false })
    : null;
  const copyAbsoluteReference = useCallback(() => {
    if (absoluteReference) void Clipboard.setStringAsync(absoluteReference);
  }, [absoluteReference]);
  const copyRelativeReference = useCallback(() => {
    if (relativeReference) void Clipboard.setStringAsync(relativeReference);
  }, [relativeReference]);
  const runTextCommand = useCallback(
    (command: FileSelectionTextCommand) => void onTextCommand?.(command),
    [onTextCommand],
  );
  const cut = useCallback(() => runTextCommand("cut"), [runTextCommand]);
  const copy = useCallback(() => runTextCommand("copy"), [runTextCommand]);
  const paste = useCallback(() => runTextCommand("paste"), [runTextCommand]);
  const selectAll = useCallback(() => runTextCommand("selectAll"), [runTextCommand]);

  return (
    <ContextMenu>
      <FileSelectionContextTarget
        selection={selection}
        absoluteReference={absoluteReference}
        relativeReference={relativeReference}
      >
        {children}
      </FileSelectionContextTarget>
      <ContextMenuContent align="start" width={240} testID="file-selection-context-menu">
        <FileSelectionMenuItem disabled={!editable} icon={Scissors} onSelect={cut}>
          {t("workspace.fileSelection.cut")}
        </FileSelectionMenuItem>
        <FileSelectionMenuItem icon={Copy} onSelect={copy}>
          {t("common.actions.copy")}
        </FileSelectionMenuItem>
        <FileSelectionMenuItem disabled={!editable} icon={ClipboardPaste} onSelect={paste}>
          {t("workspace.fileSelection.paste")}
        </FileSelectionMenuItem>
        <ContextMenuSeparator />
        <FileSelectionMenuItem icon={ListChecks} onSelect={selectAll}>
          {t("workspace.fileSelection.selectAll")}
        </FileSelectionMenuItem>
        <ContextMenuSeparator />
        {absoluteReference ? (
          <FileSelectionMenuItem
            icon={Copy}
            onSelect={copyAbsoluteReference}
            testID="file-selection-context-menu-copy-absolute"
          >
            {t("workspace.fileSelection.copyAbsolutePath")}
          </FileSelectionMenuItem>
        ) : null}
        {absoluteReference && relativeReference ? <ContextMenuSeparator /> : null}
        {relativeReference ? (
          <FileSelectionMenuItem
            icon={Copy}
            onSelect={copyRelativeReference}
            testID="file-selection-context-menu-copy-relative"
          >
            {t("workspace.fileSelection.copyRelativePath")}
          </FileSelectionMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileSelectionMenuItem({
  children,
  disabled,
  icon,
  onSelect,
  testID,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon: LucideIcon;
  onSelect: () => void;
  testID?: string;
}): ReactElement {
  const ThemedIcon = useMemo(() => withUnistyles(icon), [icon]);
  const leading = useMemo(
    () => <ThemedIcon size={ICON_SIZE.sm} uniProps={copyIconColor} />,
    [ThemedIcon],
  );
  return (
    <ContextMenuItem disabled={disabled} leading={leading} onSelect={onSelect} testID={testID}>
      {children}
    </ContextMenuItem>
  );
}

const styles = {
  target: { flex: 1, minHeight: 0 },
} as const;

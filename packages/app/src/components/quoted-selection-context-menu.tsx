import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import type { Rect } from "@/components/ui/menu";
import { isWeb } from "@/constants/platform";
import { useTranslation } from "react-i18next";
import { getQuotedSelectionText, isSameQuotedSelectionRange } from "@/components/quoted-selection";
import { QuickAskPopover } from "@/components/quick-ask-popover";
import { useShowPersistentActions } from "@/hooks/use-fine-pointer";

interface WebContextMenuEvent {
  nativeEvent: { pageX: number; pageY: number; pointerType?: string };
  preventDefault(): void;
  stopPropagation(): void;
}

function SelectionContextTarget({
  children,
  rootRef,
  onSelection,
  showSelectionActions,
  onQuote,
  onAsk,
  onPreserveSelection,
  onSelectionKeyDown,
  quoteLabel,
  askLabel,
}: {
  children: ReactNode;
  rootRef: RefObject<View | null>;
  onSelection: (text: string | null, anchorRect: Rect | null, range: Range | null) => void;
  showSelectionActions: boolean;
  onQuote: () => void;
  onAsk: () => void;
  onPreserveSelection: (event: { preventDefault(): void }) => void;
  onSelectionKeyDown: (event: { key: string }) => void;
  quoteLabel: string;
  askLabel: string;
}) {
  const contextMenu = useContextMenu();
  const updateSelection = useCallback(() => {
    if (!isWeb || !rootRef.current) return null;
    const selection = window.getSelection();
    const text = getQuotedSelectionText(
      rootRef.current as unknown as HTMLElement,
      selection,
      document.activeElement,
    );
    const range = text && selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    onSelection(
      text,
      rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      range?.cloneRange() ?? null,
    );
    return text;
  }, [onSelection, rootRef]);

  useEffect(() => {
    if (!isWeb) return;
    const clearSelection = () => onSelection(null, null, null);
    document.addEventListener("selectionchange", updateSelection);
    document.addEventListener("focusin", updateSelection);
    window.addEventListener("blur", clearSelection);
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      document.removeEventListener("focusin", updateSelection);
      window.removeEventListener("blur", clearSelection);
    };
  }, [onSelection, updateSelection]);

  const handleContextMenu = useCallback(
    (event: WebContextMenuEvent) => {
      // Keep the browser's touch selection handles and native Copy menu intact.
      if (event.nativeEvent.pointerType === "touch" || !updateSelection()) return;
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
    [contextMenu, updateSelection],
  );

  return (
    <View
      ref={rootRef}
      // @ts-expect-error onContextMenu is available on React Native Web.
      onContextMenu={handleContextMenu}
      style={styles.target}
      testID="quoted-selection-context-target"
    >
      {children}
      {showSelectionActions ? (
        <View
          style={styles.selectionActions}
          onPointerDown={onPreserveSelection}
          // @ts-expect-error onKeyDown is available on React Native Web.
          onKeyDown={onSelectionKeyDown}
          testID="quoted-selection-actions"
        >
          <Button size="sm" onPress={onQuote} testID="quoted-selection-action-quote">
            {quoteLabel}
          </Button>
          <Button size="sm" onPress={onAsk} testID="quoted-selection-action-ask">
            {askLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

export function QuotedSelectionContextMenu({
  children,
  onQuote,
  onAsk,
}: {
  children: ReactNode;
  onQuote: (text: string) => void;
  onAsk: (selectedText: string, question: string, includeContext: boolean) => Promise<string>;
}) {
  const { t } = useTranslation();
  const showPersistentActions = useShowPersistentActions();
  const rootRef = useRef<View | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionAnchorRect, setSelectionAnchorRect] = useState<Rect | null>(null);
  const [askText, setAskText] = useState<string | null>(null);
  const [askAnchorRect, setAskAnchorRect] = useState<Rect | null>(null);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setSelectedText(null);
    }
  }, []);
  const handleSelection = useCallback(
    (text: string | null, anchorRect: Rect | null, range: Range | null) => {
      setSelectedText(text);
      setSelectionAnchorRect(anchorRect);
      selectionRangeRef.current = range;
    },
    [],
  );
  const clearBrowserSelection = useCallback(() => {
    if (isWeb) window.getSelection()?.removeAllRanges();
    selectionRangeRef.current = null;
    setSelectedText(null);
  }, []);
  const getCurrentText = useCallback(() => {
    if (!isWeb || !rootRef.current) return null;
    const selection = window.getSelection();
    const text = getQuotedSelectionText(
      rootRef.current as unknown as HTMLElement,
      selection,
      document.activeElement,
    );
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (text !== selectedText || !isSameQuotedSelectionRange(selectionRangeRef.current, range)) {
      setSelectedText(null);
      selectionRangeRef.current = null;
      return null;
    }
    return text;
  }, [selectedText]);
  const handleQuote = useCallback(() => {
    const text = getCurrentText();
    if (!text) return;
    onQuote(text);
    clearBrowserSelection();
  }, [clearBrowserSelection, getCurrentText, onQuote]);
  const handleAsk = useCallback(() => {
    const text = getCurrentText();
    if (!text) return;
    setAskText(text);
    setAskAnchorRect(selectionAnchorRect);
    clearBrowserSelection();
  }, [clearBrowserSelection, getCurrentText, selectionAnchorRect]);
  const handleCloseAsk = useCallback(() => {
    setAskText(null);
    setAskAnchorRect(null);
  }, []);
  const submitAsk = useCallback(
    (question: string, includeContext: boolean) => {
      if (!askText) return Promise.reject(new Error(t("quickAsk.noSelection")));
      return onAsk(askText, question, includeContext);
    },
    [askText, onAsk, t],
  );
  const handleCopy = useCallback(() => {
    const text = getCurrentText();
    if (text) void Clipboard.setStringAsync(text);
  }, [getCurrentText]);
  // Do not collapse the native selection before a pointer activates Quote/Ask.
  const preserveSelection = useCallback(
    (event: { preventDefault(): void }) => event.preventDefault(),
    [],
  );
  const handleSelectionKeyDown = useCallback(
    (event: { key: string }) => {
      if (event.key === "Escape") clearBrowserSelection();
    },
    [clearBrowserSelection],
  );

  return (
    <>
      <ContextMenu onOpenChange={handleOpenChange}>
        <SelectionContextTarget
          rootRef={rootRef}
          onSelection={handleSelection}
          showSelectionActions={isWeb && showPersistentActions && Boolean(selectedText)}
          onQuote={handleQuote}
          onAsk={handleAsk}
          onPreserveSelection={preserveSelection}
          onSelectionKeyDown={handleSelectionKeyDown}
          quoteLabel={t("composer.attachments.quoteSelection")}
          askLabel={t("quickAsk.menuLabel")}
        >
          {children}
        </SelectionContextTarget>
        <ContextMenuContent align="start" width={200} testID="quoted-selection-context-menu">
          <ContextMenuItem onSelect={handleQuote} testID="quoted-selection-context-menu-quote">
            {t("composer.attachments.quoteSelection")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleAsk} testID="quoted-selection-context-menu-ask">
            {t("quickAsk.menuLabel")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleCopy}>{t("common.actions.copy")}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <QuickAskPopover
        visible={askText !== null}
        anchorRect={askAnchorRect}
        selectedText={askText ?? ""}
        onClose={handleCloseAsk}
        onAsk={submitAsk}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  target: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  selectionActions: {
    position: "absolute",
    bottom: theme.spacing[3],
    right: theme.spacing[3],
    left: theme.spacing[3],
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    pointerEvents: "box-none",
  },
}));

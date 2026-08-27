import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ui/context-menu";
import { isWeb } from "@/constants/platform";
import { useTranslation } from "react-i18next";
import { getQuotedSelectionText } from "@/components/quoted-selection";

interface WebContextMenuEvent {
  nativeEvent: { pageX: number; pageY: number };
  preventDefault(): void;
  stopPropagation(): void;
}

function SelectionContextTarget({
  children,
  onSelection,
}: {
  children: ReactNode;
  onSelection: (text: string) => void;
}) {
  const contextMenu = useContextMenu();
  const rootRef = useRef<View | null>(null);
  const handleContextMenu = useCallback(
    (event: WebContextMenuEvent) => {
      if (!isWeb || !rootRef.current) return;
      const text = getQuotedSelectionText(
        rootRef.current as unknown as HTMLElement,
        window.getSelection(),
      );
      if (!text) return;

      event.preventDefault();
      event.stopPropagation();
      onSelection(text);
      contextMenu.setAnchorRect({
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
        width: 0,
        height: 0,
      });
      contextMenu.setOpen(true);
    },
    [contextMenu, onSelection],
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
    </View>
  );
}

export function QuotedSelectionContextMenu({
  children,
  onQuote,
}: {
  children: ReactNode;
  onQuote: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedText(null);
  }, []);
  const handleQuote = useCallback(() => {
    if (!selectedText) return;
    onQuote(selectedText);
    if (isWeb) window.getSelection()?.removeAllRanges();
    setSelectedText(null);
  }, [onQuote, selectedText]);
  const handleCopy = useCallback(() => {
    if (!selectedText) return;
    void Clipboard.setStringAsync(selectedText);
  }, [selectedText]);

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <SelectionContextTarget onSelection={setSelectedText}>{children}</SelectionContextTarget>
      <ContextMenuContent align="start" width={200} testID="quoted-selection-context-menu">
        <ContextMenuItem onSelect={handleQuote} testID="quoted-selection-context-menu-quote">
          {t("composer.attachments.quoteSelection")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleCopy}>{t("common.actions.copy")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const styles = StyleSheet.create(() => ({
  target: {
    flex: 1,
    minHeight: 0,
  },
}));

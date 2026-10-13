import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";

export interface SidebarWorkspaceRename {
  initialValue: string;
  placeholder?: string;
  onSubmit: (value: string) => Promise<void>;
  onCancel: () => void;
}

function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function SidebarWorkspaceInlineRename({
  workspaceKey,
  rename,
}: {
  workspaceKey: string;
  rename: SidebarWorkspaceRename;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const initialValue = useRef(rename.initialValue);
  const pendingRef = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.replaceText(initialValue.current, {
      start: 0,
      end: initialValue.current.length,
    });
  }, []);

  const handleCancel = useCallback(() => {
    if (!pendingRef.current) rename.onCancel();
  }, [rename.onCancel]);
  const handleSubmit = useCallback(async () => {
    if (pendingRef.current) return;
    const value = (inputRef.current?.getText() ?? "").trim();
    if (!value) {
      setError(t("common.errors.nameRequired"));
      return;
    }
    if (value === initialValue.current.trim()) {
      rename.onCancel();
      return;
    }
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    try {
      await rename.onSubmit(value);
      rename.onCancel();
    } catch (error) {
      setError(
        error instanceof Error && error.message ? error.message : t("common.errors.unableToSave"),
      );
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }, [rename.onCancel, rename.onSubmit, t]);
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      event.stopPropagation();
      const keyboard = event.nativeEvent as TextInputKeyPressEventData & {
        isComposing?: boolean;
        keyCode?: number;
      };
      if (keyboard.key === "Escape" && !keyboard.isComposing && keyboard.keyCode !== 229) {
        event.preventDefault();
        handleCancel();
      }
    },
    [handleCancel],
  );
  const handleSubmitEditing = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);
  const handleChange = useCallback(() => setError(null), []);

  return (
    <View
      style={styles.editor}
      testID={`sidebar-workspace-rename-editor-${workspaceKey}`}
      {...(isWeb ? { onPointerDown: stopPropagation, onClick: stopPropagation } : {})}
      onTouchStart={stopPropagation}
    >
      <EditingTextInput
        ref={inputRef}
        initialValue={initialValue.current}
        placeholder={rename.placeholder}
        accessibilityLabel={t("sidebar.workspace.rename.title")}
        editable={!isPending}
        autoFocus
        selectTextOnFocus
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        onChangeText={handleChange}
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSubmitEditing}
        onBlur={handleCancel}
        style={styles.input}
        testID={`sidebar-workspace-rename-input-${workspaceKey}`}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.error}
          testID={`sidebar-workspace-rename-error-${workspaceKey}`}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  editor: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
    height: 22,
    marginVertical: -1,
    paddingVertical: 0,
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    borderRadius: theme.borderRadius.sm,
  },
  error: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
}));

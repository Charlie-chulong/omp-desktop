import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputKeyPressEventData,
} from "react-native";
import { Search, X } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  PaneContentToolbar,
  paneContentToolbarIconButtonStyle,
  paneContentToolbarIconSize,
} from "@/components/ui/pane-content-toolbar";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import {
  describeWorkspaceFilePath,
  type WorkspaceFileSearchEntry,
} from "@/file-explorer/search-model";
import { useSessionStore } from "@/stores/session-store";

const SEARCH_DEBOUNCE_MS = 100;
const SEARCH_RESULT_LIMIT = 100;

interface FileExplorerSearchState {
  requestKey: string | null;
  entries: readonly WorkspaceFileSearchEntry[];
  loading: boolean;
  error: string | null;
}

const EMPTY_SEARCH_STATE: FileExplorerSearchState = {
  requestKey: null,
  entries: [],
  loading: false,
  error: null,
};

function searchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name !== "DaemonRpcError") return error.message;
  return error.message.replace(/ requestType=\S+(?: code=\S+)?$/, "");
}

function useFileExplorerSearch({
  serverId,
  workspaceRoot,
  query,
}: {
  serverId: string;
  workspaceRoot: string;
  query: string;
}): FileExplorerSearchState {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const normalizedQuery = query.trim();
  const requestKey =
    client && workspaceRoot && normalizedQuery
      ? `${serverId}\0${workspaceRoot}\0${normalizedQuery}`
      : null;
  const [state, setState] = useState<FileExplorerSearchState>(EMPTY_SEARCH_STATE);

  useEffect(() => {
    if (!requestKey || !client) {
      setState(EMPTY_SEARCH_STATE);
      return;
    }

    const activeClient = client;
    let cancelled = false;
    setState({ requestKey, entries: [], loading: true, error: null });

    const timer = setTimeout(() => {
      void activeClient
        .getDirectorySuggestions({
          cwd: workspaceRoot,
          query: normalizedQuery,
          includeFiles: true,
          includeDirectories: false,
          limit: SEARCH_RESULT_LIMIT,
        })
        .then((payload) => {
          if (cancelled) return;
          setState({
            requestKey,
            entries: payload.error
              ? []
              : payload.entries.map(({ path }) => describeWorkspaceFilePath(path)),
            loading: false,
            error: payload.error ?? null,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState({
            requestKey,
            entries: [],
            loading: false,
            error: searchErrorMessage(error),
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, normalizedQuery, requestKey, workspaceRoot]);

  if (!requestKey) return EMPTY_SEARCH_STATE;
  if (state.requestKey !== requestKey) {
    return { requestKey, entries: [], loading: true, error: null };
  }
  return state;
}

interface FileExplorerSearchProps {
  serverId: string;
  workspaceRoot: string;
  isCompact: boolean;
  onOpenFile?: (path: string) => void;
  onClose: () => void;
}

export function FileExplorerSearch({
  serverId,
  workspaceRoot,
  isCompact,
  onOpenFile,
  onClose,
}: FileExplorerSearchProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { entries, loading, error } = useFileExplorerSearch({
    serverId,
    workspaceRoot,
    query,
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [entries, query]);

  const openEntry = useCallback(
    (entry: WorkspaceFileSearchEntry) => {
      onOpenFile?.(entry.path);
    },
    [onOpenFile],
  );

  const openSelectedEntry = useCallback(() => {
    const entry = entries[selectedIndex];
    if (entry) openEntry(entry);
  }, [entries, openEntry, selectedIndex]);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      switch (event.nativeEvent.key) {
        case "ArrowDown":
          setSelectedIndex((index) => Math.min(index + 1, Math.max(0, entries.length - 1)));
          break;
        case "ArrowUp":
          setSelectedIndex((index) => Math.max(0, index - 1));
          break;
        case "Escape":
          if (query) {
            inputRef.current?.replaceText("");
            setQuery("");
          } else {
            onClose();
          }
          break;
      }
    },
    [entries.length, onClose, query],
  );

  const closeButtonStyle = useCallback(
    (state: PressableStateCallbackType) =>
      paneContentToolbarIconButtonStyle(state, false, isCompact),
    [isCompact],
  );

  const renderResult = useCallback(
    ({ item, index }: ListRenderItemInfo<WorkspaceFileSearchEntry>) => (
      <SearchResultRow
        entry={item}
        selected={index === selectedIndex}
        onHover={() => setSelectedIndex(index)}
        onPress={() => openEntry(item)}
      />
    ),
    [openEntry, selectedIndex],
  );

  const content = useMemo(() => {
    if (!query.trim()) {
      return (
        <View style={styles.centerState}>
          <Search size={20} color={theme.colors.foregroundExtraMuted} />
          <Text style={styles.stateText}>{t("shell.commandCenter.filePlaceholder")}</Text>
        </View>
      );
    }
    if (loading) {
      return (
        <View style={styles.centerState}>
          <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }
    if (entries.length === 0) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{t("shell.commandCenter.noMatches")}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={entries}
        renderItem={renderResult}
        keyExtractor={(entry) => entry.path}
        keyboardShouldPersistTaps="handled"
        testID="file-explorer-search-results"
        contentContainerStyle={styles.resultsContent}
        initialNumToRender={24}
        maxToRenderPerBatch={40}
        windowSize={12}
      />
    );
  }, [entries, error, loading, query, renderResult, t, theme.colors]);

  return (
    <View style={styles.container}>
      <PaneContentToolbar style={styles.searchToolbar} testID="file-explorer-search-toolbar">
        <Search size={paneContentToolbarIconSize(isCompact)} color={theme.colors.foregroundMuted} />
        <TextInput
          ref={inputRef}
          autoFocus
          initialValue=""
          onChangeText={setQuery}
          onKeyPress={handleKeyPress}
          onSubmitEditing={openSelectedEntry}
          placeholder={t("shell.commandCenter.filePlaceholder")}
          placeholderTextColor={theme.colors.foregroundExtraMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          accessibilityLabel={t("shell.commandCenter.filePlaceholder")}
          style={styles.searchInput}
          testID="file-explorer-search-input"
        />
        {loading ? (
          <View style={styles.trailingIcon}>
            <LoadingSpinner
              size={paneContentToolbarIconSize(isCompact)}
              color={theme.colors.foregroundMuted}
            />
          </View>
        ) : null}
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={closeButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.close")}
          testID="file-explorer-search-close"
        >
          <X size={paneContentToolbarIconSize(isCompact)} color={theme.colors.foregroundMuted} />
        </Pressable>
      </PaneContentToolbar>
      <View style={styles.results}>{content}</View>
    </View>
  );
}

function SearchResultRow({
  entry,
  selected,
  onHover,
  onPress,
}: {
  entry: WorkspaceFileSearchEntry;
  selected: boolean;
  onHover: () => void;
  onPress: () => void;
}) {
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.resultRow,
      (selected || Boolean(hovered) || pressed) && styles.resultRowSelected,
    ],
    [selected],
  );

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHover}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={entry.path}
      testID={`file-explorer-search-result-${entry.path}`}
    >
      <View style={styles.fileIcon}>
        <MaterialFileIcon fileName={entry.name} size={16} />
      </View>
      <View style={styles.resultLabels}>
        <Text style={styles.fileName} numberOfLines={1}>
          {entry.name}
        </Text>
        {entry.directory ? (
          <Text style={styles.directory} numberOfLines={1}>
            {entry.directory}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  searchToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 32,
    paddingHorizontal: 0,
    paddingVertical: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  trailingIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  results: {
    flex: 1,
    minHeight: 0,
  },
  resultsContent: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  resultRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  resultRowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  fileIcon: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  resultLabels: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  directory: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

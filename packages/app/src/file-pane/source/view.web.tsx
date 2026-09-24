import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getLanguageForFile } from "@omp-desktop/highlight";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { EditorVisualTheme } from "../editor/extensions.web";
import { editorTheme } from "../editor/extensions.web";
import {
  FileSelectionContextMenu,
  getFileSelectionRange,
  type FileSelectionRange,
  type FileSelectionTextCommand,
} from "@/components/file-selection-context-menu";
import { selectSourcePresentation, type SourcePresentation } from "./presentation";

interface FileSourceViewProps {
  content: string;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  size: number;
  theme: EditorVisualTheme;
  tooLargeMessage: string;
  workspaceRoot?: string;
}

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();

export function FileSourceView({
  content,
  filename,
  location,
  navigationRevision,
  size,
  theme,
  tooLargeMessage,
  workspaceRoot,
}: FileSourceViewProps) {
  const presentation = selectSourcePresentation({ size, platform: "web" });
  if (presentation === "unsupported") {
    return (
      <div data-testid="file-source-too-large" style={UNSUPPORTED_STYLE}>
        {tooLargeMessage}
      </div>
    );
  }
  return (
    <ReadonlyCodeMirror
      content={content}
      filename={filename}
      location={location}
      navigationRevision={navigationRevision}
      presentation={presentation}
      theme={theme}
      workspaceRoot={workspaceRoot ?? ""}
    />
  );
}

function ReadonlyCodeMirror({
  content,
  filename,
  location,
  navigationRevision,
  presentation,
  theme,
  workspaceRoot,
}: Omit<FileSourceViewProps, "size" | "tooLargeMessage"> & {
  presentation: Exclude<SourcePresentation, "unsupported">;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handleTextCommand = useCallback(async (command: FileSelectionTextCommand) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    if (command === "copy") {
      await Clipboard.setStringAsync(view.state.sliceDoc(selection.from, selection.to));
      return;
    }
    if (command === "selectAll") {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    }
  }, []);
  const [selection, setSelection] = useState<FileSelectionRange | null>(null);
  const initial = useRef({ content, filename, presentation, theme });

  useEffect(() => {
    if (!hostRef.current) return;
    const values = initial.current;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: values.content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          languageCompartment.of(
            languageFor({ filename: values.filename, presentation: values.presentation }),
          ),
          themeCompartment.of(editorTheme(values.theme)),
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet && !update.docChanged) return;
            setSelection(
              getFileSelectionRange({
                from: update.state.selection.main.from,
                to: update.state.selection.main.to,
                lineAt: (position) => update.state.doc.lineAt(position),
              }),
            );
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, [content]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        languageCompartment.reconfigure(languageFor({ filename, presentation })),
        themeCompartment.reconfigure(editorTheme(theme)),
      ],
    });
  }, [filename, presentation, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !location.lineStart) return;
    const line = Math.min(location.lineStart, view.state.doc.lines);
    const from = view.state.doc.line(line).from;
    view.dispatch({ effects: EditorView.scrollIntoView(from, { y: "center" }) });
  }, [location.lineStart, navigationRevision]);

  return (
    <FileSelectionContextMenu
      path={location.path}
      workspaceRoot={workspaceRoot ?? ""}
      selection={selection}
      onTextCommand={handleTextCommand}
    >
      <div ref={hostRef} data-testid="file-source-editor" style={HOST_STYLE} />
    </FileSelectionContextMenu>
  );
}

function languageFor(input: {
  filename: string;
  presentation: Exclude<SourcePresentation, "unsupported">;
}) {
  return input.presentation === "highlighted"
    ? (getLanguageForFile(input.filename)?.extension ?? [])
    : [];
}

const HOST_STYLE = { flex: 1, minHeight: 0, overflow: "hidden" } as const;
const UNSUPPORTED_STYLE = {
  alignItems: "center",
  display: "flex",
  flex: 1,
  justifyContent: "center",
} as const;

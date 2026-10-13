import type { ExternalAppRuntime } from "../external-app-runtime.js";

export type EditorTargetKind = "editor" | "file-manager";

export interface EditorTargetDescriptor {
  id: string;
  label: string;
  kind: EditorTargetKind;
}

export interface EditorTargetLaunchInput {
  workspacePath: string;
  filePath?: string;
  line?: number;
  column?: number;
}

export interface EditorTargetRuntime extends ExternalAppRuntime {
  isAbsolutePath(path: string): boolean;
  openPath(path: string): Promise<void>;
  revealPath(path: string): void;
}

export interface EditorTarget {
  readonly id: string;

  describe(runtime: EditorTargetRuntime): Promise<EditorTargetDescriptor>;
  isInstalled(runtime: EditorTargetRuntime): Promise<boolean>;
  launch(input: EditorTargetLaunchInput, runtime: EditorTargetRuntime): Promise<void>;
}

import { posix, win32 } from "node:path";
import { shell } from "electron";

import {
  createExternalAppRuntime,
  type ExternalAppRuntimeOptions,
} from "../external-app-runtime.js";
import type { EditorTargetRuntime } from "./target.js";

export interface EditorTargetRuntimeOptions extends ExternalAppRuntimeOptions {
  openPath?: (path: string) => Promise<string>;
  revealPath?: (path: string) => void;
}

export function createEditorTargetRuntime(
  options: EditorTargetRuntimeOptions = {},
): EditorTargetRuntime {
  const externalRuntime = createExternalAppRuntime(options);
  const platform = externalRuntime.platform;
  const openPath = options.openPath ?? ((targetPath) => shell.openPath(targetPath));
  const revealPath = options.revealPath ?? ((targetPath) => shell.showItemInFolder(targetPath));

  return {
    ...externalRuntime,
    isAbsolutePath(targetPath) {
      return platform === "win32" ? win32.isAbsolute(targetPath) : posix.isAbsolute(targetPath);
    },
    async openPath(targetPath) {
      const errorMessage = await openPath(
        platform === "win32" ? win32.normalize(targetPath) : targetPath,
      );
      if (errorMessage) throw new Error(errorMessage);
    },
    revealPath(targetPath) {
      revealPath(platform === "win32" ? win32.normalize(targetPath) : targetPath);
    },
  };
}

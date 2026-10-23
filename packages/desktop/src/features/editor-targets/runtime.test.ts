import type { SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";

import { createEditorTargetRuntime } from "./runtime.js";

interface SpawnRecord {
  command: string;
  args: string[];
  options: SpawnOptions;
  unrefed: boolean;
}

describe("editor target runtime", () => {
  it.each([
    ["d:/project/mini-electron/v8/", "d:\\project\\mini-electron\\v8\\"],
    ["C:/项目/repo & workspace\\src/file.ts", "C:\\项目\\repo & workspace\\src\\file.ts"],
    ["//server/share/project/", "\\\\server\\share\\project\\"],
  ])("uses native Windows shell paths for %s", async (input, expected) => {
    const opened: string[] = [];
    const revealed: string[] = [];
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      openPath: async (target) => {
        opened.push(target);
        return "";
      },
      revealPath: (target) => {
        revealed.push(target);
      },
    });
    await runtime.openPath(input);
    runtime.revealPath(input);
    expect(opened).toEqual([expected]);
    expect(revealed).toEqual([expected]);
  });

  it.each(["darwin", "linux"] as const)("preserves POSIX filenames on %s", async (platform) => {
    const paths: string[] = [];
    const runtime = createEditorTargetRuntime({
      platform,
      openPath: async (target) => {
        paths.push(target);
        return "";
      },
      revealPath: (target) => {
        paths.push(target);
      },
    });
    const target = "/tmp/project/back\\slash";
    await runtime.openPath(target);
    runtime.revealPath(target);
    expect(paths).toEqual([target, target]);
  });

  it("resolves command aliases and safely launches Windows command scripts", async () => {
    const records: SpawnRecord[] = [];
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: {
        PATH: "C:/Program Files/Editors & Tools/bin",
        ELECTRON_RUN_AS_NODE: "1",
      },
      pathExists: (targetPath) => targetPath === "C:/Program Files/Editors & Tools/bin/code.cmd",
      spawn: (command, args, options) => {
        const record = { command, args, options, unrefed: false };
        records.push(record);
        const child = {
          once(event: "error" | "spawn", handler: (error?: Error) => void) {
            if (event === "spawn") queueMicrotask(() => handler());
            return child;
          },
          unref() {
            record.unrefed = true;
          },
        };
        return child;
      },
    });

    const command = runtime.resolveCommand(["missing", "code"]);
    if (!command) throw new Error("Expected the editor command to resolve");
    await runtime.spawnDetached({
      command,
      args: ["C:/repo & workspace", "C:/repo/src/file & calculator.ts"],
    });

    expect(records).toEqual([
      {
        command: '"C:/Program Files/Editors & Tools/bin/code.cmd"',
        args: ['"C:/repo & workspace"', '"C:/repo/src/file & calculator.ts"'],
        options: {
          detached: true,
          env: { PATH: "C:/Program Files/Editors & Tools/bin" },
          shell: true,
          stdio: "ignore",
        },
        unrefed: true,
      },
    ]);
  });
});

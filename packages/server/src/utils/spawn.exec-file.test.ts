import type * as ChildProcessModule from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const childProcess = await importOriginal<typeof ChildProcessModule>();
  return {
    ...childProcess,
    // Match mini-electron's ASAR wrapper: forward callbacks, not promisify metadata.
    execFile(
      file: string,
      args: readonly string[],
      options: ChildProcessModule.ExecFileOptionsWithStringEncoding,
      callback: (
        error: ChildProcessModule.ExecFileException | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) {
      return childProcess.execFile(file, args, options, callback);
    },
  };
});

import { getOmpInstallationStatus } from "../server/agent/providers/omp/installer.js";
import { execCommand } from "./spawn.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("execCommand with a callback-only execFile wrapper", () => {
  test.each([
    {
      script: 'process.stdout.write("omp/18.12.1\\n"); process.stderr.write("diagnostic\\n")',
      stdout: "omp/18.12.1\n",
      stderr: "diagnostic\n",
    },
    {
      script: 'process.stderr.write("omp/18.12.1\\n")',
      stdout: "",
      stderr: "omp/18.12.1\n",
    },
    { script: "", stdout: "", stderr: "" },
  ])("collects both output streams for $script", async ({ script, stdout, stderr }) => {
    await expect(execCommand(process.execPath, ["-e", script])).resolves.toEqual({
      stdout,
      stderr,
    });
  });

  test("rejects a nonzero exit with its real output and exit code", async () => {
    await expect(
      execCommand(process.execPath, [
        "-e",
        'process.stdout.write("partial output\\n"); process.stderr.write("version failed\\n"); process.exitCode = 23',
      ]),
    ).rejects.toMatchObject({
      code: 23,
      killed: false,
      stdout: "partial output\n",
      stderr: "version failed\n",
      message: expect.stringContaining("version failed"),
    });
  });

  test("preserves spawn failures instead of reporting empty success", async () => {
    await expect(
      execCommand(join(tmpdir(), randomUUID(), "missing-omp.exe"), ["--version"]),
    ).rejects.toMatchObject({ code: "ENOENT", stdout: "", stderr: "" });
  });

  // OS child-process termination needs the platform timeout, not fake JS timers.
  test("preserves timeout termination", async () => {
    await expect(
      execCommand(process.execPath, ["-e", "process.stdin.resume()"], {
        timeout: 100,
        killSignal: "SIGKILL",
      }),
    ).rejects.toMatchObject({ killed: true, signal: "SIGKILL" });
  });

  test("preserves the output buffer limit", async () => {
    await expect(
      execCommand(process.execPath, ["-e", 'process.stdout.write("x".repeat(1024))'], {
        maxBuffer: 16,
      }),
    ).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stderr: "" });
  });

  test("forwards abort signals to execFile", async () => {
    const controller = new AbortController();
    const command = execCommand(process.execPath, ["-e", "process.stdin.resume()"], {
      signal: controller.signal,
    });
    controller.abort();

    await expect(command).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
  });

  test("detects the real version of a configured bundled executable", async () => {
    vi.stubEnv("OMP_COMMAND", process.execPath);
    vi.stubEnv("PASEO_DESKTOP_MANAGED", "1");

    await expect(getOmpInstallationStatus()).resolves.toMatchObject({
      installed: true,
      source: "bundled",
      installPath: process.execPath,
      version: process.version,
    });
  });
});

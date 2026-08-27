import { delimiter, dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  compareOmpVersions,
  ensureManagedOmpOnPath,
  resolveManagedOmpInstallPath,
} from "./installer.js";

describe("OMP managed installer", () => {
  test("uses the official per-user install location on macOS and Linux", () => {
    expect(resolveManagedOmpInstallPath("darwin", {}, "/Users/test")).toBe(
      join("/Users/test", ".local", "bin", "omp"),
    );
    expect(resolveManagedOmpInstallPath("linux", {}, "/home/test")).toBe(
      join("/home/test", ".local", "bin", "omp"),
    );
  });

  test("uses LOCALAPPDATA for Windows", () => {
    expect(
      resolveManagedOmpInstallPath(
        "win32",
        { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
        "C:\\Users\\test",
      ),
    ).toBe(join("C:\\Users\\test\\AppData\\Local", "omp", "omp.exe"));
  });

  test("prepends the managed install directory to PATH once", () => {
    const env: NodeJS.ProcessEnv = { PATH: ["/usr/local/bin", "/usr/bin"].join(delimiter) };
    ensureManagedOmpOnPath("darwin", env);
    ensureManagedOmpOnPath("darwin", env);

    const installDirectory = dirname(resolveManagedOmpInstallPath("darwin", env));
    expect(env.PATH?.split(delimiter)).toEqual([installDirectory, "/usr/local/bin", "/usr/bin"]);
  });

  test("compares installed and latest OMP versions without offering downgrades", () => {
    expect(compareOmpVersions("omp/18.0.4", "v18.0.4")).toBe(0);
    expect(compareOmpVersions("oh-my-pi v17.9.9", "18.0.0")).toBe(-1);
    expect(compareOmpVersions("omp 19.0.0", "v18.2.3")).toBe(1);
    expect(compareOmpVersions("unknown", "v18.2.3")).toBeNull();
  });
});

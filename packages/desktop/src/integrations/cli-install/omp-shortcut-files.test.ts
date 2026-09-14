import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installOmpShortcutAtPaths,
  isManagedOmpShortcut,
  uninstallOmpShortcutAtPaths,
} from "./omp-shortcut-files";

const temporaryDirectories: string[] = [];

async function createPaths(filename = "omp") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omp-shortcut-test-"));
  temporaryDirectories.push(directory);
  const sourcePath = path.join(directory, "bundle", "omp");
  const targetPath = path.join(directory, "local", "bin", filename);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, "binary");
  return { sourcePath, targetPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("OMP command shortcut", () => {
  it("migrates the legacy symlink to a proxy-aware POSIX command", async () => {
    const paths = await createPaths();
    const input = {
      ...paths,
      platform: "darwin" as const,
      proxyUrl: "http://127.0.0.1:7890",
    };
    await mkdir(path.dirname(paths.targetPath), { recursive: true });
    await symlink(paths.sourcePath, paths.targetPath);

    await installOmpShortcutAtPaths(input);

    const contents = await readFile(paths.targetPath, "utf8");
    expect(contents).toContain("export PI_PROXY='http://127.0.0.1:7890'");
    expect(contents).toContain('export HTTPS_PROXY="$PI_PROXY"');
    expect(contents).toContain(`exec '${paths.sourcePath}' "$@"`);
    expect(await isManagedOmpShortcut(input)).toBe(true);

    const changedProxy = { ...input, proxyUrl: "http://127.0.0.1:7891" };
    expect(await isManagedOmpShortcut(changedProxy)).toBe(false);
    await installOmpShortcutAtPaths(changedProxy);
    expect(await readFile(paths.targetPath, "utf8")).toContain("http://127.0.0.1:7891");

    await uninstallOmpShortcutAtPaths(changedProxy);
    expect(await isManagedOmpShortcut(changedProxy)).toBe(false);
  });

  it("preserves an existing command it does not own", async () => {
    const paths = await createPaths();
    const input = { ...paths, platform: "linux" as const };
    await mkdir(path.dirname(paths.targetPath), { recursive: true });
    await writeFile(paths.targetPath, "user command");

    await expect(installOmpShortcutAtPaths(input)).rejects.toThrow("already exists");
    await uninstallOmpShortcutAtPaths(input);

    expect(await readFile(paths.targetPath, "utf8")).toBe("user command");
  });

  it("uses an owned command trampoline on Windows", async () => {
    const paths = await createPaths("omp.cmd");
    const input = {
      ...paths,
      platform: "win32" as const,
      proxyUrl: "http://user:p%40ss@127.0.0.1:7890",
    };

    await installOmpShortcutAtPaths(input);

    expect(await readFile(paths.targetPath, "utf8")).toContain(
      'set "PI_PROXY=http://user:p%%40ss@127.0.0.1:7890"',
    );
    expect(await isManagedOmpShortcut(input)).toBe(true);

    await uninstallOmpShortcutAtPaths(input);
    expect(await isManagedOmpShortcut(input)).toBe(false);
  });
});

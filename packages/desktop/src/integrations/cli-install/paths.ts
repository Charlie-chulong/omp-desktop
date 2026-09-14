import path from "node:path";
import os from "node:os";
import { app } from "electron";

export function getLocalBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

export function getCliTargetPath(): string {
  const filename = process.platform === "win32" ? "omp-desktop.cmd" : "omp-desktop";
  return path.join(getLocalBinDir(), filename);
}

export function getOmpShortcutTargetPath(): string {
  const filename = process.platform === "win32" ? "omp.cmd" : "omp";
  return path.join(getLocalBinDir(), filename);
}

export function getBundledOmpExecutablePath(): string {
  const filename = process.platform === "win32" ? "omp.exe" : "omp";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", filename);
  }

  const developmentFilename = `omp-${process.platform}-${process.arch}${
    process.platform === "win32" ? ".exe" : ""
  }`;
  return path.resolve(app.getAppPath(), "..", "..", "bin", developmentFilename);
}

export function getBundledCliShimPath(): string {
  const cliShimFilename = process.platform === "win32" ? "omp-desktop.cmd" : "omp-desktop";

  if (process.platform === "darwin") {
    const electronExePath = app.getPath("exe");
    const appBundle = electronExePath.replace(/\/Contents\/MacOS\/.+$/, "");
    return path.join(appBundle, "Contents", "Resources", "bin", cliShimFilename);
  }

  if (process.platform === "win32") {
    const electronExePath = app.getPath("exe");
    return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
  }

  // Linux
  const electronExePath = app.getPath("exe");
  return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
}

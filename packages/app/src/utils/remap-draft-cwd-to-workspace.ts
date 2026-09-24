export function remapDraftCwdToWorkspace(input: {
  cwd: string;
  sourceDirectory?: string | null;
  workspaceDirectory: string;
}): string {
  const cwd = input.cwd.trim();
  const sourceDirectory = input.sourceDirectory?.trim();
  const workspaceDirectory = input.workspaceDirectory.trim();
  if (!cwd || !sourceDirectory) return workspaceDirectory;

  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedSource = sourceDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  const isWindowsPath = /^[a-zA-Z]:\//.test(normalizedCwd) || /^[a-zA-Z]:\//.test(normalizedSource);
  const comparableCwd = isWindowsPath ? normalizedCwd.toLowerCase() : normalizedCwd;
  const comparableSource = isWindowsPath ? normalizedSource.toLowerCase() : normalizedSource;
  if (comparableCwd === comparableSource) return workspaceDirectory;

  const relativePath = comparableCwd.startsWith(`${comparableSource}/`)
    ? normalizedCwd.slice(normalizedSource.length + 1)
    : "";
  if (!relativePath) return workspaceDirectory;
  const separator =
    workspaceDirectory.includes("\\") && !workspaceDirectory.includes("/") ? "\\" : "/";
  return [workspaceDirectory.replace(/[\\/]+$/, ""), ...relativePath.split("/")]
    .filter(Boolean)
    .join(separator);
}

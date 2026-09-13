import type { RemoteSshTarget } from "./types.js";
import { RemoteSshTargetSchema } from "./types.js";

export interface SshArgumentOptions {
  tty?: boolean;
  controlPath?: string;
  controlMaster?: boolean;
  batchMode?: boolean;
}

export function buildSshArguments(
  input: RemoteSshTarget,
  options: SshArgumentOptions = {},
): string[] {
  const target = RemoteSshTargetSchema.parse(input);
  const args = [
    "-o",
    "ConnectTimeout=30",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];
  if (options.controlPath) args.push("-S", options.controlPath);
  if (options.controlMaster) args.push("-M", "-o", "ControlPersist=no");
  if (options.batchMode) args.push("-o", "BatchMode=yes");
  if (target.port !== undefined) args.push("-p", String(target.port));
  if (target.identityFile) args.push("-i", target.identityFile);
  args.push(
    options.tty === false ? "-T" : "-tt",
    target.username ? `${target.username}@${target.host}` : target.host,
  );
  return args;
}

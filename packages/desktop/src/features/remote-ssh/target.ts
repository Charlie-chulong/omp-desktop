import type { RemoteSshTarget } from "./types.js";
import { RemoteSshTargetSchema } from "./types.js";

export function buildSshArguments(input: RemoteSshTarget): string[] {
  const target = RemoteSshTargetSchema.parse(input);
  const args = [
    "-o",
    "ConnectTimeout=30",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];
  if (target.port !== undefined) args.push("-p", String(target.port));
  if (target.identityFile) args.push("-i", target.identityFile);
  args.push("-tt", target.username ? `${target.username}@${target.host}` : target.host);
  return args;
}

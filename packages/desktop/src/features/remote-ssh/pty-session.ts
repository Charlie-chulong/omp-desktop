import os from "node:os";
import * as pty from "node-pty";
import { MarkerBuffer } from "./marker-buffer.js";
import { buildSshArguments } from "./target.js";
import type { RemoteSshTarget } from "./types.js";

export interface SshPtySessionOptions {
  target: RemoteSshTarget;
  remoteCommand: string;
  onTerminal: (data: string) => void;
}

export class SshPtySession {
  private readonly markers = new MarkerBuffer();
  private readonly process: pty.IPty;
  private interactive = true;
  private closed = false;

  constructor(options: SshPtySessionOptions) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    this.process = pty.spawn("ssh", [...buildSshArguments(options.target), options.remoteCommand], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: os.homedir(),
      env,
    });
    this.process.onData((data) => {
      this.markers.push(data);
      if (this.interactive) options.onTerminal(data);
    });
    this.process.onExit(({ exitCode, signal }) => {
      this.closed = true;
      this.markers.rejectAll(
        new Error(`SSH exited before deployment completed (exit ${exitCode}, signal ${signal})`),
      );
    });
  }

  writeInput(input: string): void {
    if (!this.interactive || this.closed) {
      throw new Error("The SSH session is not accepting interactive input");
    }
    this.process.write(input);
  }

  writeCommand(command: string): void {
    if (this.closed) throw new Error("The SSH session is closed");
    this.process.write(`${command}\r`);
  }

  waitForLine(marker: string, timeoutMs?: number): Promise<string> {
    return this.markers.waitForLine(marker, timeoutMs);
  }

  finishAuthentication(): void {
    this.interactive = false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.process.kill();
    this.markers.rejectAll(new Error("SSH deployment was cancelled"));
  }
}

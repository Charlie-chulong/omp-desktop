import { describe, expect, it } from "vitest";
import { buildSshArguments, resolveSshExecutable } from "./target.js";

const fileDoesNotExist = () => false;

describe("buildSshArguments", () => {
  it("builds argv without invoking a shell", () => {
    expect(
      buildSshArguments({
        host: "build-server",
        username: "deploy",
        port: 2222,
        identityFile: "/Users/dev/.ssh/work key",
      }),
    ).toEqual([
      "-o",
      "ConnectTimeout=30",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-p",
      "2222",
      "-i",
      "/Users/dev/.ssh/work key",
      "-tt",
      "deploy@build-server",
    ]);
  });

  it("builds a non-interactive multiplexed connection", () => {
    expect(
      buildSshArguments(
        { host: "build-server", username: "deploy" },
        { tty: false, controlPath: "/tmp/omp.sock", batchMode: true },
      ),
    ).toEqual([
      "-o",
      "ConnectTimeout=30",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-S",
      "/tmp/omp.sock",
      "-o",
      "BatchMode=yes",
      "-T",
      "deploy@build-server",
    ]);
  });

  it.each(["-oProxyCommand=evil", "host\ncommand", "host with-space"])(
    "rejects unsafe host %j",
    (host) => {
      expect(() => buildSshArguments({ host })).toThrow();
    },
  );
});

describe("resolveSshExecutable", () => {
  it("resolves ssh.exe before starting a Windows PTY with an identity file", () => {
    const executable = String.raw`C:\Windows\System32\OpenSSH\ssh.exe`;
    const identityFile = String.raw`D:\pem\aliyun\ckcc.pem`;

    expect(
      resolveSshExecutable("win32", { SystemRoot: String.raw`C:\Windows` }, (candidate) => {
        return candidate === executable;
      }),
    ).toBe(executable);
    expect(buildSshArguments({ host: "build-server", identityFile })).toContain(identityFile);
  });

  it("reports a missing Windows OpenSSH client directly", () => {
    expect(() => resolveSshExecutable("win32", {}, fileDoesNotExist)).toThrow(
      "Install the Windows OpenSSH Client feature",
    );
  });
});

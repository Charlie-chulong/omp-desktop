import { describe, expect, it } from "vitest";
import { buildSshArguments } from "./target.js";

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

  it.each(["-oProxyCommand=evil", "host\ncommand", "host with-space"])(
    "rejects unsafe host %j",
    (host) => {
      expect(() => buildSshArguments({ host })).toThrow();
    },
  );
});

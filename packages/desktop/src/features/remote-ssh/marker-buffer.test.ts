import { describe, expect, it } from "vitest";
import { MarkerBuffer } from "./marker-buffer.js";

describe("MarkerBuffer", () => {
  it("resolves markers split across PTY chunks and normalizes carriage returns", async () => {
    const buffer = new MarkerBuffer();
    const result = buffer.waitForLine("__OMP_RESULT__");
    buffer.push("noise\r\n__OMP_RES");
    buffer.push("ULT__payload\r\n");
    await expect(result).resolves.toBe("payload");
  });

  it("rejects pending operations when the SSH process exits", async () => {
    const buffer = new MarkerBuffer();
    const result = buffer.waitForLine("__OMP_READY__");
    buffer.rejectAll(new Error("SSH exited"));
    await expect(result).rejects.toThrow("SSH exited");
  });
});

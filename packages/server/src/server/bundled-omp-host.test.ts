import { createHash } from "node:crypto";
import { promises as fs, writeFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBundledOmpHost,
  BUNDLED_OMP_HOST,
  createBundledOmpHostVerifier,
  createSha256FileCache,
  sha256RegularFile,
} from "./bundled-omp-host.js";

const digest = (content: string) => createHash("sha256").update(content).digest("hex");
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "omp-file-hash-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await fs.rm(root, { recursive: true, force: true });
});

function corruptAfterRead(handle: FileHandle, file: string): void {
  const createReadStream = handle.createReadStream.bind(handle);
  vi.spyOn(handle, "createReadStream").mockImplementationOnce((options) => {
    const stream = createReadStream(options);
    stream.once("end", () => writeFileSync(file, "tampered"));
    return stream;
  });
}

describe("createSha256FileCache", () => {
  it("hashes real bytes once for concurrent and repeated stable lookups, but not across caches", async () => {
    const file = join(root, "payload");
    const content = "private payload bytes\n".repeat(8192);
    await fs.writeFile(file, content);
    const open = vi.spyOn(fs, "open");
    syncBuiltinESMExports();
    const hashFile = createSha256FileCache();
    const results = await Promise.all(Array.from({ length: 12 }, () => hashFile(file)));
    expect(results).toEqual(Array(12).fill(digest(content)));
    expect(open).toHaveBeenCalledTimes(1);
    await expect(hashFile(file)).resolves.toBe(digest(content));
    expect(open).toHaveBeenCalledTimes(1);
    await expect(createSha256FileCache()(file)).resolves.toBe(digest(content));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("rehashes in-place byte edits, even when size and mtime are restored", async () => {
    const file = join(root, "payload");
    const originalTime = new Date("2000-01-01T00:00:00.000Z");
    await fs.writeFile(file, "original");
    await fs.utimes(file, originalTime, originalTime);
    const before = await fs.lstat(file, { bigint: true });
    const hashFile = createSha256FileCache();
    await expect(hashFile(file)).resolves.toBe(digest("original"));
    await fs.writeFile(file, "tampered");
    await fs.utimes(file, originalTime, originalTime);
    const after = await fs.lstat(file, { bigint: true });
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ctimeNs).not.toBe(before.ctimeNs);
    await expect(hashFile(file)).resolves.toBe(digest("tampered"));
  });

  it("rehashes a replacement at the same path with matching size and mtime", async () => {
    const file = join(root, "payload");
    const originalTime = new Date("2000-01-01T00:00:00.000Z");
    await fs.writeFile(file, "original");
    await fs.utimes(file, originalTime, originalTime);
    const before = await fs.lstat(file, { bigint: true });
    const hashFile = createSha256FileCache();
    await expect(hashFile(file)).resolves.toBe(digest("original"));
    await fs.rename(file, join(root, "previous-payload"));
    await fs.writeFile(file, "replaced");
    await fs.utimes(file, originalTime, originalTime);
    const after = await fs.lstat(file, { bigint: true });
    expect(after.ino).not.toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    await expect(hashFile(file)).resolves.toBe(digest("replaced"));
  });

  it("rejects symlinks and directories instead of reusing an earlier digest, then recovers", async () => {
    const file = join(root, "payload");
    const outside = join(root, "outside");
    // Windows junctions do not require Developer Mode or symlink privileges.
    if (process.platform === "win32") await fs.mkdir(outside);
    else await fs.writeFile(outside, "must not follow this regular-file symlink");
    await fs.writeFile(file, "original");
    const hashFile = createSha256FileCache();
    await expect(hashFile(file)).resolves.toBe(digest("original"));
    await fs.rm(file);
    await fs.symlink(outside, file, process.platform === "win32" ? "junction" : "file");
    await expect(hashFile(file)).rejects.toThrow("Expected a regular file");
    await fs.rm(file, { recursive: true });
    await fs.mkdir(file);
    await expect(hashFile(file)).rejects.toThrow("Expected a regular file");
    await fs.rm(file, { recursive: true });
    await fs.writeFile(file, "recovered");
    await expect(hashFile(file)).resolves.toBe(digest("recovered"));
  });

  it("does not leave a missing-file or failed-open result cached", async () => {
    const file = join(root, "payload");
    const hashFile = createSha256FileCache();
    await expect(hashFile(file)).rejects.toThrow();
    await fs.writeFile(file, "recovered");
    const open = vi.spyOn(fs, "open").mockRejectedValueOnce(new Error("Interrupted file read"));
    syncBuiltinESMExports();
    await expect(hashFile(file)).rejects.toThrow("Interrupted file read");
    await expect(hashFile(file)).resolves.toBe(digest("recovered"));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("fails closed without retry if bytes change while the real stream is consumed", async () => {
    const file = join(root, "payload");
    await fs.writeFile(file, "original");
    const realOpen = fs.open;
    const open = vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await realOpen(...args);
      corruptAfterRead(handle, file);
      return handle;
    });
    syncBuiltinESMExports();
    const hashFile = createSha256FileCache();
    await expect(hashFile(file)).rejects.toThrow("File changed while computing SHA-256");
    expect(open).toHaveBeenCalledTimes(1);
    await expect(hashFile(file)).resolves.toBe(digest("tampered"));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("rejects a pathname replacement between inspection and open, then hashes its new identity", async () => {
    const file = join(root, "payload");
    await fs.writeFile(file, "original");
    const realOpen = fs.open;
    const open = vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      await fs.rename(file, join(root, "previous-payload"));
      await fs.writeFile(file, "replaced");
      return realOpen(...args);
    });
    syncBuiltinESMExports();
    const hashFile = createSha256FileCache();
    await expect(hashFile(file)).rejects.toThrow("File changed while computing SHA-256");
    expect(open).toHaveBeenCalledTimes(1);
    await expect(hashFile(file)).resolves.toBe(digest("replaced"));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("keeps the uncached file hasher strict on every call", async () => {
    const file = join(root, "payload");
    await fs.writeFile(file, "original");
    const open = vi.spyOn(fs, "open");
    syncBuiltinESMExports();
    await expect(sha256RegularFile(file)).resolves.toBe(digest("original"));
    await expect(sha256RegularFile(file)).resolves.toBe(digest("original"));
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("bundled host verifier constraints", () => {
  it("does not inspect a command when the bundled payload is absent", async () => {
    const open = vi.spyOn(fs, "open");
    syncBuiltinESMExports();
    await expect(assertBundledOmpHost(undefined, {})).resolves.toBeUndefined();
    await expect(createBundledOmpHostVerifier()(undefined, {})).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("retains platform, absolute executable and fixed-checksum enforcement", async () => {
    const env = { OMP_DESKTOP_BUNDLED_PLUGINS: root };
    for (const verify of [assertBundledOmpHost, createBundledOmpHostVerifier()]) {
      if (
        process.platform !== BUNDLED_OMP_HOST.platform ||
        process.arch !== BUNDLED_OMP_HOST.arch
      ) {
        await expect(verify(join(root, "host.exe"), env)).rejects.toThrow("private Windows x64");
        continue;
      }
      await expect(verify("host.exe", env)).rejects.toThrow("absolute private OMP executable");
      const file = join(root, "host.exe");
      await fs.writeFile(file, "not the private Windows host");
      await expect(verify(file, env)).rejects.toThrow("SHA-256 mismatch");
      await fs.rm(file);
      await expect(verify(file, env)).rejects.toThrow("missing or unreadable");
    }
  });
});

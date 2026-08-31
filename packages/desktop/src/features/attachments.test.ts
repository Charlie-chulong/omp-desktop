import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyAttachmentFileToManagedStorage,
  garbageCollectManagedAttachmentFiles,
  ManagedAttachmentReferenceRegistry,
  readManagedFileBase64,
} from "./attachments";

const originalPaseoHome = process.env.PASEO_HOME;
let testHome: string | null = null;

async function useTempPaseoHome(): Promise<string> {
  testHome = await mkdtemp(path.join(os.tmpdir(), "paseo-desktop-attachments-"));
  process.env.PASEO_HOME = testHome;
  return testHome;
}

describe("desktop attachment files", () => {
  afterEach(async () => {
    if (originalPaseoHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = originalPaseoHome;
    }

    if (testHome) {
      await rm(testHome, { recursive: true, force: true });
      testHome = null;
    }
  });

  it("accepts dot-prefixed picker extensions for managed copies", async () => {
    const paseoHome = await useTempPaseoHome();
    const sourcePath = path.join(paseoHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown",
      sourcePath,
      extension: ".md",
    });

    expect(result).toEqual({
      path: path.join(paseoHome, "desktop-attachments", "att_markdown.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  it("normalizes legacy bare extensions for managed copies", async () => {
    const paseoHome = await useTempPaseoHome();
    const sourcePath = path.join(paseoHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown_legacy",
      sourcePath,
      extension: "md",
    });

    expect(result).toEqual({
      path: path.join(paseoHome, "desktop-attachments", "att_markdown_legacy.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  it("copies and reads image paths with non-ASCII filenames", async () => {
    const paseoHome = await useTempPaseoHome();
    const sourcePath = path.join(paseoHome, "截屏2026-08-31 上午8.02.50.png");
    await writeFile(sourcePath, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_unicode_image",
      sourcePath,
      extension: ".png",
    });

    await expect(readManagedFileBase64({ path: result.path })).resolves.toBe("iVBORw0KGgo=");
  });

  it("does not garbage collect a newly managed attachment", async () => {
    const paseoHome = await useTempPaseoHome();
    const sourcePath = path.join(paseoHome, "image.png");
    await writeFile(sourcePath, new Uint8Array([1, 2, 3]));
    const attachment = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_recent",
      sourcePath,
      extension: ".png",
    });
    const nowMs = Date.now();

    await expect(
      garbageCollectManagedAttachmentFiles({ referencedIds: [] }, { minimumAgeMs: 60_000, nowMs }),
    ).resolves.toBe(0);
    await expect(readFile(attachment.path)).resolves.toEqual(Buffer.from([1, 2, 3]));

    await expect(
      garbageCollectManagedAttachmentFiles(
        { referencedIds: [] },
        { minimumAgeMs: 60_000, nowMs: nowMs + 120_000 },
      ),
    ).resolves.toBe(1);
  });
});

describe("managed attachment reference registry", () => {
  it("waits for every active window and collects their reference union", () => {
    const registry = new ManagedAttachmentReferenceRegistry();

    expect(
      registry.update({
        ownerId: 1,
        activeOwnerIds: [1, 2],
        referencedIds: ["att_window_1"],
      }),
    ).toBeNull();
    expect(
      registry.update({
        ownerId: 2,
        activeOwnerIds: [1, 2],
        referencedIds: ["att_window_2"],
      }),
    ).toEqual(new Set(["att_window_1", "att_window_2"]));

    expect(
      registry.update({
        ownerId: 1,
        activeOwnerIds: [1],
        referencedIds: ["att_window_1_next"],
      }),
    ).toEqual(new Set(["att_window_1_next"]));
  });
});

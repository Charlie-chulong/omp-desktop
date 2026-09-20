import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "paseo-present-image-tool-"));
  tempDirs.push(dir);
  return dir;
}

function createCatalog(cwd: string, callerAgentId = "agent-1") {
  return createPaseoToolCatalog({
    agentManager: {
      getAgent: (id: string) => (id === callerAgentId ? { cwd } : null),
    } as unknown as AgentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    callerAgentId,
    logger: pino({ level: "silent" }),
  });
}

describe("present_image Paseo tool", () => {
  it("publishes a local raster image for the conversation", async () => {
    const cwd = await makeTempDir();
    const filePath = path.join(cwd, "qr.png");
    await writeFile(filePath, PNG_1X1);
    const catalog = createCatalog(cwd);

    const result = await catalog.executeTool("present_image", {
      path: filePath,
      alt: "WeChat login QR code",
    });

    expect(result.structuredContent).toEqual({
      status: "published",
      filePath,
      mimeType: "image/png",
      alt: "WeChat login QR code",
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Published the image to the conversation (status=published). The desktop renders it in the chat. Never claim the user can see an image from `read` alone.",
      },
    ]);
  });

  it("resolves a relative path against the caller workspace", async () => {
    const cwd = await makeTempDir();
    await writeFile(path.join(cwd, "qr.png"), PNG_1X1);
    const catalog = createCatalog(cwd);

    const result = await catalog.executeTool("present_image", { path: "qr.png" });

    expect(result.structuredContent).toMatchObject({
      status: "published",
      filePath: path.join(cwd, "qr.png"),
      mimeType: "image/png",
    });
  });

  it("rejects non-image files", async () => {
    const cwd = await makeTempDir();
    await writeFile(path.join(cwd, "notes.txt"), "not an image\n");
    const catalog = createCatalog(cwd);

    await expect(catalog.executeTool("present_image", { path: "notes.txt" })).rejects.toThrow(
      "not a raster image",
    );
  });

  it("requires an agent-scoped caller", async () => {
    const catalog = createCatalog("/tmp", "");
    await expect(catalog.executeTool("present_image", { path: "/tmp/qr.png" })).rejects.toThrow(
      "agent-scoped",
    );
  });
});

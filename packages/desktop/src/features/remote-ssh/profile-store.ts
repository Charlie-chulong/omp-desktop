import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RemoteSshProfileInputSchema, type RemoteSshProfileInput } from "./types.js";

const ProfileDocumentSchema = z.object({
  version: z.literal(1),
  profiles: z.record(z.string(), RemoteSshProfileInputSchema),
});

type ProfileDocument = z.infer<typeof ProfileDocumentSchema>;

export interface RemoteSshProfileStore {
  get(serverId: string): Promise<RemoteSshProfileInput | null>;
  save(profile: RemoteSshProfileInput): Promise<void>;
  remove(serverId: string): Promise<void>;
}

export function createRemoteSshProfileStore(userDataPath: string): RemoteSshProfileStore {
  const filePath = path.join(userDataPath, "remote-ssh-hosts.json");
  let writeQueue = Promise.resolve();

  async function readDocument(): Promise<ProfileDocument> {
    try {
      return ProfileDocumentSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, profiles: {} };
      }
      throw new Error(
        `Failed to read SSH-managed host profiles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function persist(document: ProfileDocument): Promise<void> {
    await mkdir(userDataPath, { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  function enqueue(update: (document: ProfileDocument) => Promise<void>): Promise<void> {
    const next = writeQueue.then(async () => update(await readDocument()));
    writeQueue = next.catch(() => undefined);
    return next;
  }

  return {
    async get(serverId) {
      const document = await readDocument();
      return document.profiles[serverId] ?? null;
    },
    save(profile) {
      const parsed = RemoteSshProfileInputSchema.parse(profile);
      return enqueue(async (document) => {
        document.profiles[parsed.serverId] = parsed;
        await persist(document);
      });
    },
    remove(serverId) {
      return enqueue(async (document) => {
        delete document.profiles[serverId];
        await persist(document);
      });
    },
  };
}

import { describe, expect, test } from "vitest";

import {
  loadOmpProviderAccountNotes,
  OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY,
  ompProviderAccountNotesStorageKey,
  saveOmpProviderAccountNotes,
  updateOmpProviderAccountNote,
} from "./omp-provider-account-notes";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async removeItem(key: string) {
      values.delete(key);
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("OMP provider account notes", () => {
  test("round-trips notes through validated storage", async () => {
    const storage = createMemoryStorage();
    await saveOmpProviderAccountNotes(storage, { "4": "个人订阅" });

    await expect(loadOmpProviderAccountNotes(storage)).resolves.toEqual({ "4": "个人订阅" });
    expect(storage.values.has(OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY)).toBe(true);
  });

  test("updates and removes trimmed account notes", () => {
    const withNote = updateOmpProviderAccountNote({}, 4, "  主账号  ");
    expect(withNote).toEqual({ "4": "主账号" });
    expect(updateOmpProviderAccountNote(withNote, 4, " ")).toEqual({});
  });
  test("uses separate storage keys for separate hosts", async () => {
    const storage = createMemoryStorage();
    await saveOmpProviderAccountNotes(storage, { "4": "主机 A" }, "host-a");
    await saveOmpProviderAccountNotes(storage, { "4": "主机 B" }, "host-b");

    await expect(loadOmpProviderAccountNotes(storage, "host-a")).resolves.toEqual({
      "4": "主机 A",
    });
    await expect(loadOmpProviderAccountNotes(storage, "host-b")).resolves.toEqual({
      "4": "主机 B",
    });
    expect(ompProviderAccountNotesStorageKey()).toBe(OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY);
  });
});

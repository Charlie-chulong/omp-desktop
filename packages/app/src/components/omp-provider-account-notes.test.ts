import { describe, expect, test } from "vitest";

import {
  loadLegacyOmpProviderAccountNotes,
  removeLegacyOmpProviderAccountNotes,
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
  test("loads the host-scoped legacy value before the original unscoped value", async () => {
    const storage = createMemoryStorage();
    await storage.setItem(
      "@omp-desktop:omp-provider-account-notes",
      JSON.stringify({ "4": "旧默认" }),
    );
    await storage.setItem(
      "@omp-desktop:omp-provider-account-notes:host-a",
      JSON.stringify({ "4": "主机 A" }),
    );

    await expect(loadLegacyOmpProviderAccountNotes(storage, "host-a")).resolves.toEqual({
      key: "@omp-desktop:omp-provider-account-notes:host-a",
      notes: { "4": "主机 A" },
    });
  });

  test("falls back to and removes the original unscoped legacy value", async () => {
    const storage = createMemoryStorage();
    const key = "@omp-desktop:omp-provider-account-notes";
    await storage.setItem(key, JSON.stringify({ "4": "个人订阅" }));

    await expect(loadLegacyOmpProviderAccountNotes(storage, "host-a")).resolves.toEqual({
      key,
      notes: { "4": "个人订阅" },
    });
    await removeLegacyOmpProviderAccountNotes(storage, key);
    expect(storage.values.has(key)).toBe(false);
  });

  test("updates and removes trimmed account notes", () => {
    const withNote = updateOmpProviderAccountNote({}, 4, "  主账号  ");
    expect(withNote).toEqual({ "4": "主账号" });
    expect(updateOmpProviderAccountNote(withNote, 4, " ")).toEqual({});
  });
});

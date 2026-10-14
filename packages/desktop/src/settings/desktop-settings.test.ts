import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopSettings,
  createDesktopSettingsStore,
} from "./desktop-settings";

async function createTempUserDataDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "paseo-desktop-settings-"));
}

function settingsFilePath(userDataPath: string): string {
  return path.join(userDataPath, "desktop-settings.json");
}

describe("desktop-settings", () => {
  const directories = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...directories].map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
      }),
    );
    directories.clear();
  });

  it("serializes concurrent pet and unrelated patches without losing either change", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });
    await Promise.all([
      store.patch({ pet: { enabled: true, selectedId: "custom-cat" } }),
      store.patch({ pet: { position: { x: -1240, y: 420 }, size: "large" } }),
      store.patch({ notifications: { playSound: false } }),
    ]);
    const restarted = await createDesktopSettingsStore({ userDataPath }).get();
    expect(restarted.pet).toEqual({
      enabled: true,
      selectedId: "custom-cat",
      size: "large",
      position: { x: -1240, y: 420 },
    });
    expect(restarted.notifications.playSound).toBe(false);
  });

  it("notifies only committed writes and leaves cached preferences unchanged after failure", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });
    await store.get();
    const notifications: DesktopSettings[] = [];
    const unsubscribe = store.subscribe((settings) => notifications.push(settings));
    const file = settingsFilePath(userDataPath);
    await rename(file, `${file}.saved`);
    await mkdir(file);
    await expect(store.patch({ pet: { enabled: true } })).rejects.toThrow();
    expect(notifications).toEqual([]);
    expect((await store.get()).pet.enabled).toBe(false);
    await rm(file, { recursive: true });
    await rename(`${file}.saved`, file);
    const committed = await store.patch({ pet: { enabled: true } });
    expect(notifications).toEqual([committed]);
    expect(JSON.parse(await readFile(file, "utf8")).settings.pet.enabled).toBe(true);
    unsubscribe();
    await store.patch({ pet: { enabled: false } });
    expect(notifications).toHaveLength(1);
    expect(await readdir(userDataPath)).toEqual(["desktop-settings.json"]);
  });

  it("rejects invalid pet fields and isolates returned objects from persisted state", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });
    await store.patch({ pet: { selectedId: "custom", position: { x: -100, y: 50 } } });
    const settings = await store.patch({
      pet: { enabled: "yes", size: "huge", selectedId: "", position: { x: Infinity, y: 0 } },
    });
    expect(settings.pet).toEqual({
      enabled: false,
      size: "medium",
      selectedId: "custom",
      position: { x: -100, y: 50 },
    });
    settings.pet.position!.x = 999;
    settings.pet.selectedId = "mutated";
    expect((await store.get()).pet.selectedId).toBe("custom");
    expect((await store.get()).pet.position!.x).toBe(-100);
    await store.patch({ pet: { position: null } });
    expect((await createDesktopSettingsStore({ userDataPath }).get()).pet.position).toBeNull();
  });

  it("persists default settings for new users", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });

    const settings = await store.get();
    const persisted = JSON.parse(await readFile(settingsFilePath(userDataPath), "utf8")) as {
      settings: DesktopSettings;
    };

    expect(settings).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(persisted.settings).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("handles concurrent first-launch reads without racing the settings write", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });

    const settings = await Promise.all(Array.from({ length: 20 }, () => store.get()));
    const persisted = JSON.parse(await readFile(settingsFilePath(userDataPath), "utf8")) as {
      settings: DesktopSettings;
    };
    const files = await readdir(userDataPath);

    expect(settings).toEqual(Array.from({ length: 20 }, () => DEFAULT_DESKTOP_SETTINGS));
    expect(persisted.settings).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(files).toEqual(["desktop-settings.json"]);
  });

  it("coerces invalid persisted values back to safe defaults", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    await writeFile(
      settingsFilePath(userDataPath),
      JSON.stringify({
        version: 1,
        settings: {
          releaseChannel: "nightly",
          daemon: {
            manageBuiltInDaemon: "sometimes",
            keepRunningAfterQuit: false,
          },
        },
      }),
    );
    const store = createDesktopSettingsStore({ userDataPath });

    const settings = await store.get();

    expect(settings).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("patches nested settings and leaves no temp files behind", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });

    await store.get();
    const next = await store.patch({
      releaseChannel: "beta",
      daemon: { keepRunningAfterQuit: false },
    });
    const files = await readdir(userDataPath);

    expect(next).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      releaseChannel: "beta",
    });
    expect(files).toEqual(["desktop-settings.json"]);
  });

  it("persists a selected browser and rejects unknown targets", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });

    const selected = await store.patch({ browser: { target: "firefox" } });
    const rejected = await store.patch({ browser: { target: "arbitrary-executable" } });
    const restored = await createDesktopSettingsStore({ userDataPath }).get();

    expect(selected.browser.target).toBe("firefox");
    expect(rejected.browser.target).toBe("firefox");
    expect(restored.browser.target).toBe("firefox");
  });

  it("defaults notification sounds on for existing settings documents", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    await writeFile(
      settingsFilePath(userDataPath),
      JSON.stringify({
        version: 1,
        settings: {
          releaseChannel: "stable",
          daemon: {
            manageBuiltInDaemon: true,
            keepRunningAfterQuit: false,
          },
        },
        migrations: {
          legacyRendererSettingsImported: true,
          daemonStopOnQuitDefaultApplied: true,
        },
      }),
    );

    const settings = await createDesktopSettingsStore({ userDataPath }).get();

    expect(settings.notifications.playSound).toBe(true);
  });

  it("keeps an explicit notification sound choice across restarts", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);

    await createDesktopSettingsStore({ userDataPath }).patch({
      notifications: { playSound: false },
    });

    const settings = await createDesktopSettingsStore({ userDataPath }).get();

    expect(settings.notifications.playSound).toBe(false);
  });

  it("keeps a remembered window-close choice across restarts", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);

    await createDesktopSettingsStore({ userDataPath }).patch({
      window: { closeBehavior: "background" },
    });

    const settings = await createDesktopSettingsStore({ userDataPath }).get();

    expect(settings.window.closeBehavior).toBe("background");
  });

  it("does not let stale legacy renderer settings override an explicit desktop patch", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });

    const patched = await store.patch({
      daemon: {
        manageBuiltInDaemon: false,
      },
    });
    const migrated = await store.migrateLegacyRendererSettings({
      manageBuiltInDaemon: true,
      releaseChannel: "beta",
    });
    const persisted = JSON.parse(await readFile(settingsFilePath(userDataPath), "utf8")) as {
      migrations: { legacyRendererSettingsImported: boolean };
      settings: DesktopSettings;
    };

    expect(patched.daemon.manageBuiltInDaemon).toBe(false);
    expect(migrated.daemon.manageBuiltInDaemon).toBe(false);
    expect(migrated.releaseChannel).toBe("stable");
    expect(persisted.migrations.legacyRendererSettingsImported).toBe(true);
    expect(persisted.settings.daemon.manageBuiltInDaemon).toBe(false);
  });

  it("does not rewrite existing settings while reading them", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const raw = JSON.stringify({
      version: 1,
      settings: {
        releaseChannel: "stable",
        daemon: {
          manageBuiltInDaemon: false,
          keepRunningAfterQuit: true,
        },
      },
      migrations: {
        legacyRendererSettingsImported: false,
      },
    });
    await writeFile(settingsFilePath(userDataPath), raw);
    const store = createDesktopSettingsStore({ userDataPath });

    const settings = await store.get();
    const persisted = await readFile(settingsFilePath(userDataPath), "utf8");

    expect(settings.daemon.manageBuiltInDaemon).toBe(false);
    expect(persisted).toBe(raw);
  });

  it("resets the pre-existing keep-running default so the daemon stops with the app", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    await writeFile(
      settingsFilePath(userDataPath),
      JSON.stringify({
        version: 1,
        settings: {
          releaseChannel: "stable",
          daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
        },
        migrations: { legacyRendererSettingsImported: true },
      }),
    );
    const store = createDesktopSettingsStore({ userDataPath });

    const settings = await store.get();

    expect(settings.daemon.keepRunningAfterQuit).toBe(false);
  });

  it("keeps an explicit keep-running choice across restarts", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    await writeFile(
      settingsFilePath(userDataPath),
      JSON.stringify({
        version: 1,
        settings: {
          releaseChannel: "stable",
          daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
        },
        migrations: { legacyRendererSettingsImported: true },
      }),
    );
    await createDesktopSettingsStore({ userDataPath }).patch({
      daemon: { keepRunningAfterQuit: true },
    });

    const settings = await createDesktopSettingsStore({ userDataPath }).get();

    expect(settings.daemon.keepRunningAfterQuit).toBe(true);
  });

  it("migrates desktop-owned values from legacy renderer settings once", async () => {
    const userDataPath = await createTempUserDataDir();
    directories.add(userDataPath);
    const store = createDesktopSettingsStore({ userDataPath });

    await store.patch({
      daemon: {
        keepRunningAfterQuit: false,
      },
    });

    const migrated = await store.migrateLegacyRendererSettings({
      releaseChannel: "beta",
      manageBuiltInDaemon: false,
      theme: "dark",
    });
    const ignoredSecondMigration = await store.migrateLegacyRendererSettings({
      releaseChannel: "stable",
      manageBuiltInDaemon: true,
    });

    expect(migrated).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      releaseChannel: "beta",
      daemon: {
        manageBuiltInDaemon: false,
        keepRunningAfterQuit: false,
      },
    });
    expect(ignoredSecondMigration).toEqual(migrated);
  });
});

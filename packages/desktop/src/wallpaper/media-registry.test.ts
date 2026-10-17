import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_WALLPAPER_DIRECTORY_ENTRIES, WallpaperMediaRegistry } from "./media-registry";

const temporaryRoots: string[] = [];

function createFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "omp-wallpaper-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("WallpaperMediaRegistry", () => {
  it("returns sorted regular media files with opaque stable capabilities", async () => {
    const root = createFixtureRoot();
    writeFileSync(path.join(root, "wallpaper10.png"), "ten");
    writeFileSync(path.join(root, "wallpaper2.png"), "two");
    writeFileSync(path.join(root, "notes.txt"), "not media");
    mkdirSync(path.join(root, "fake.jpg"));
    const registry = new WallpaperMediaRegistry();

    const files = await registry.scanDirectory(root);

    expect(files.map((file) => file.name)).toEqual(["wallpaper2.png", "wallpaper10.png"]);
    expect(files.every((file) => !file.id.includes(root))).toBe(true);
    expect((await registry.scanDirectory(root)).map((file) => file.id)).toEqual(
      files.map((file) => file.id),
    );
    expect(registry.get(files[0].id)).toEqual(
      expect.objectContaining({
        path: realpathSync(path.join(root, "wallpaper2.png")),
        mime: "image/png",
      }),
    );
  });

  it("rejects files outside the selected directory and unsupported active content", async () => {
    const parent = createFixtureRoot();
    const selectedDirectory = path.join(parent, "selected");
    mkdirSync(selectedDirectory);
    const outside = path.join(parent, "outside.png");
    const svg = path.join(selectedDirectory, "active.svg");
    writeFileSync(outside, "outside");
    writeFileSync(svg, "<svg/>");
    const registry = new WallpaperMediaRegistry();

    await expect(
      registry.resolveFile({ directory: selectedDirectory, path: outside }),
    ).resolves.toBeNull();
    await expect(
      registry.resolveFile({ directory: selectedDirectory, path: svg }),
    ).resolves.toBeNull();
    await expect(
      registry.resolveFile({ directory: selectedDirectory, path: selectedDirectory }),
    ).resolves.toBeNull();
  });

  it("bounds directory enumeration before capabilities and previews grow without limit", async () => {
    const root = createFixtureRoot();
    for (let index = 0; index < MAX_WALLPAPER_DIRECTORY_ENTRIES + 12; index += 1) {
      writeFileSync(path.join(root, `${index}.jpg`), String(index));
    }

    await expect(new WallpaperMediaRegistry().scanDirectory(root)).resolves.toHaveLength(
      MAX_WALLPAPER_DIRECTORY_ENTRIES,
    );
  });
});

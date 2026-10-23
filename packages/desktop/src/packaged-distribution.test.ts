import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPackagedDesktopDistribution } from "./packaged-distribution";

const roots: string[] = [];

function makeApp(privatePlugins: boolean) {
  const resources = mkdtempSync(path.join(tmpdir(), "omp-distribution-policy-"));
  roots.push(resources);
  const appRoot = path.join(resources, "app");
  mkdirSync(appRoot);
  writeFileSync(
    path.join(appRoot, "package.json"),
    JSON.stringify(privatePlugins ? { ompDesktopDistribution: "private-three-plugins" } : {}),
  );
  return { resources, appRoot };
}

function writeHost(resources: string, content: string) {
  const hostPath = path.join(resources, "bin", process.platform === "win32" ? "omp.exe" : "omp");
  mkdirSync(path.dirname(hostPath), { recursive: true });
  writeFileSync(hostPath, content);
  return createHash("sha256").update(content).digest("hex");
}

function writeManifest(resources: string, sha256: unknown) {
  const payload = path.join(resources, "bundled-omp-plugins");
  mkdirSync(payload, { recursive: true });
  writeFileSync(
    path.join(payload, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, host: { platform: "win32", arch: "x64", sha256 } }),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("packaged distribution policy", () => {
  it("does not enable private provisioning from leftover payload files in a public app", () => {
    const { resources, appRoot } = makeApp(false);
    writeManifest(resources, writeHost(resources, "sealed fixture host"));
    const distribution = readPackagedDesktopDistribution(appRoot);
    expect(distribution.privatePlugins).toBe(false);
    expect(distribution.identity).toBe("public");
    expect(distribution.bundledPluginsPath).toBeNull();
  });

  it("keeps a no-OMP public app eligible for its external runtime", () => {
    const { appRoot } = makeApp(false);
    const distribution = readPackagedDesktopDistribution(appRoot);
    expect(distribution.bundledOmpPath).toBeNull();
    expect(distribution.bundledPluginsPath).toBeNull();
  });

  it("distinguishes private hosts even when the application version is unchanged", () => {
    const { resources, appRoot } = makeApp(true);
    const original = writeHost(resources, "original host");
    writeManifest(resources, original);
    const before = readPackagedDesktopDistribution(appRoot).identity;
    const replacement = writeHost(resources, "replacement host");
    writeManifest(resources, replacement);
    const after = readPackagedDesktopDistribution(appRoot).identity;
    expect(before).toBe(`private-three-plugins:${original}`);
    expect(after).toBe(`private-three-plugins:${replacement}`);
    expect(after).not.toBe(before);
  });

  it("refuses private mode without its host or a valid bound-host identity", () => {
    const { resources, appRoot } = makeApp(true);
    expect(() => readPackagedDesktopDistribution(appRoot)).toThrow("qualified OMP host");
    writeHost(resources, "private fixture host");
    writeManifest(resources, []);
    expect(() => readPackagedDesktopDistribution(appRoot)).toThrow("bound-host identity");
  });
});

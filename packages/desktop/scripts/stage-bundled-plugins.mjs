#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(desktopRoot, "..", "..");
const vendorRoot = path.join(repositoryRoot, "vendor", "omp-plugins");
const output = path.join(desktopRoot, "bundled-omp-plugins");
const hostSha256 = "ec012a0edab06ef80ff455b30a5b3221d81b314f60d0b3a2ccc21b81fbf91d43";
const packages = [
  { name: "omp-bridge-chatpro", version: "0.1.0" },
  { name: "omp-workbuddy-plugin", version: "0.1.0" },
  { name: "omp-wechat-connector", version: "0.1.2" },
];
const excludedDirectories = new Set([
  ".git",
  ".venv",
  "node_modules",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  ".runtime-building",
  "artifacts",
]);
const forbiddenFiles = new Set([
  ".env",
  "auth.json",
  "credentials.json",
  ".omp-wechat-install.json",
]);

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyPackage(source, destination, relative = "") {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Plugin source directory is not a regular directory: ${source}`);
  }
  mkdirSync(destination, { recursive: true });
  const inventory = [];
  for (const name of readdirSync(source).sort()) {
    const from = path.join(source, name);
    const to = path.join(destination, name);
    const child = relative ? `${relative}/${name}` : name;
    const info = lstatSync(from);
    if (info.isSymbolicLink()) throw new Error(`Plugin links are not bundled: ${child}`);
    if (info.isDirectory()) {
      if (!excludedDirectories.has(name)) {
        inventory.push(...(await copyPackage(from, to, child)));
      }
    } else if (info.isFile()) {
      if (/\.(pyc|pyo)$/i.test(name)) continue;
      if (forbiddenFiles.has(name.toLowerCase()) || name.toLowerCase().startsWith(".env.")) {
        throw new Error(`Private configuration cannot enter a bundled plugin: ${child}`);
      }
      copyFileSync(from, to);
      inventory.push({ path: child, sha256: await hashFile(to), bytes: info.size });
    } else {
      throw new Error(`Nonregular plugin file: ${child}`);
    }
  }
  return inventory;
}

if (
  process.argv.length !== 4 ||
  process.argv[2] !== "--host" ||
  !path.isAbsolute(process.argv[3])
) {
  throw new Error(
    "Usage: node scripts/stage-bundled-plugins.mjs --host <absolute verified custom OMP executable>",
  );
}
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The private three-plugin distribution targets Windows x64 only.");
}
const hostSource = process.argv[3];
if (
  !lstatSync(hostSource).isFile() ||
  lstatSync(hostSource).isSymbolicLink() ||
  (await hashFile(hostSource)) !== hostSha256
) {
  throw new Error("The private distribution requires the exact jointly qualified custom OMP host.");
}
if (existsSync(output))
  throw new Error("Bundled plugin output already exists; refusing to overwrite it.");
const wechatRuntime = path.join(
  vendorRoot,
  "omp-wechat-connector",
  "runtime",
  "runtime-manifest.json",
);
if (!existsSync(wechatRuntime))
  throw new Error("Build the complete portable WeChat CPython3.12/Tk runtime before staging.");
const stage = mkdtempSync(path.join(desktopRoot, ".bundled-plugins-stage-"));
try {
  const plugins = [];
  for (const pkg of packages) {
    const source = path.join(vendorRoot, pkg.name);
    const metadata = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
    if (
      metadata.name !== pkg.name ||
      metadata.version !== pkg.version ||
      !metadata.omp?.extensions?.length
    ) {
      throw new Error(`Unexpected bundled plugin identity or native entrypoint: ${pkg.name}`);
    }
    const files = await copyPackage(source, path.join(stage, pkg.name));
    plugins.push({ ...pkg, directory: pkg.name, files });
  }
  const manifest = {
    schemaVersion: 1,
    host: { version: "18.12.1", sha256: hostSha256, platform: "win32", arch: "x64" },
    plugins,
  };
  writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const binaryDirectory = path.join(repositoryRoot, "bin");
  mkdirSync(binaryDirectory, { recursive: true });
  const binaryStage = path.join(stage, "omp-windows-x64.exe");
  copyFileSync(hostSource, binaryStage);
  if ((await hashFile(binaryStage)) !== hostSha256)
    throw new Error("Custom host changed during staging.");
  const binaryTarget = path.join(binaryDirectory, "omp-windows-x64.exe");
  if (existsSync(binaryTarget))
    throw new Error("OMP binary target already exists; refusing to overwrite it.");
  renameSync(binaryStage, binaryTarget);
  renameSync(stage, output);
  console.log(
    JSON.stringify(
      {
        output,
        hostSha256,
        plugins: plugins.map(({ name, version, files }) => ({
          name,
          version,
          files: files.length,
          bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
}

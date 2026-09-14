import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";

const REPOSITORY = "can1357/oh-my-pi";
const LATEST_RELEASE_URL = `https://github.com/${REPOSITORY}/releases/latest`;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(rootDir, "bin");

const targets = new Map([
  ["darwin-arm64", "omp-darwin-arm64"],
  ["darwin-x64", "omp-darwin-x64"],
  ["linux-arm64", "omp-linux-arm64"],
  ["linux-x64", "omp-linux-x64"],
  ["windows-arm64", "omp-windows-arm64.exe"],
  ["windows-x64", "omp-windows-x64.exe"],
]);

function printUsage() {
  console.log(`Usage: node scripts/download-omp-binaries.mjs [target ...]

Downloads and checksum-verifies OMP binaries from the latest GitHub release.
With no targets, all supported binaries are downloaded.

Targets:
${[...targets.keys()].map((target) => `  ${target}`).join("\n")}`);
}

function resolveSelectedTargets(args) {
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  const selected = args.length === 0 ? [...targets.keys()] : args;
  const invalid = selected.filter((target) => !targets.has(target));
  if (invalid.length > 0) {
    throw new Error(`Unknown OMP target(s): ${invalid.join(", ")}`);
  }
  return selected;
}

function requestHeaders() {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return {
    "User-Agent": "OMP-Desktop",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchRequired(url, label, method = "GET") {
  const response = await fetch(url, {
    method,
    headers: requestHeaders(),
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
  }
  return response;
}

function parseChecksums(contents) {
  const checksums = new Map();
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^([a-f\d]{64})\s+\*?(.+)$/iu.exec(line.trim());
    if (match) checksums.set(match[2], match[1].toLowerCase());
  }
  return checksums;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function replaceFile(destination, temporary) {
  const backup = `${destination}.previous`;
  await rm(backup, { force: true });
  let movedExisting = false;
  if (await fileExists(destination)) {
    await rename(destination, backup);
    movedExisting = true;
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    if (movedExisting) await rename(backup, destination).catch(() => undefined);
    throw error;
  }
  if (movedExisting) await rm(backup, { force: true });
}

async function downloadAsset(assetName, downloadUrl, expectedChecksum) {
  const destination = path.join(outputDir, assetName);
  if ((await fileExists(destination)) && (await sha256File(destination)) === expectedChecksum) {
    if (!assetName.endsWith(".exe")) await chmod(destination, 0o755);
    console.log(`Up to date: ${assetName}`);
    return;
  }

  const temporary = `${destination}.${process.pid}.download`;
  await rm(temporary, { force: true });
  console.log(`Downloading ${assetName}`);
  try {
    const response = await fetchRequired(downloadUrl, `Download ${assetName}`);
    if (!response.body) throw new Error(`Download ${assetName} returned an empty response body`);
    const contentLength = Number(response.headers.get("content-length"));
    const expectedBytes =
      Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : null;

    const hash = createHash("sha256");
    let receivedBytes = 0;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        receivedBytes += chunk.length;
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      verifier,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );

    if (expectedBytes !== null && receivedBytes !== expectedBytes) {
      throw new Error(
        `Download ${assetName} was incomplete: received ${receivedBytes} of ${expectedBytes} bytes`,
      );
    }
    const actualChecksum = hash.digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Checksum mismatch for ${assetName}: expected ${expectedChecksum}, received ${actualChecksum}`,
      );
    }
    if (!assetName.endsWith(".exe")) await chmod(temporary, 0o755);
    await replaceFile(destination, temporary);
    console.log(`Updated: ${assetName}`);
  } finally {
    await rm(temporary, { force: true });
  }
}

const selectedTargets = resolveSelectedTargets(process.argv.slice(2));
const latestResponse = await fetchRequired(
  LATEST_RELEASE_URL,
  "Resolve latest OMP release",
  "HEAD",
);
const releaseUrl = new URL(latestResponse.url);
const tagPrefix = `/${REPOSITORY}/releases/tag/`;
if (releaseUrl.origin !== "https://github.com" || !releaseUrl.pathname.startsWith(tagPrefix)) {
  throw new Error(`Latest OMP release resolved to an unexpected URL: ${latestResponse.url}`);
}
const releaseTag = decodeURIComponent(releaseUrl.pathname.slice(tagPrefix.length));
if (!releaseTag) throw new Error("Latest OMP release did not include a release tag");
const releaseBaseUrl = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(releaseTag)}`;
const checksums = parseChecksums(
  await (await fetchRequired(`${releaseBaseUrl}/SHA256SUMS.txt`, "Download OMP checksums")).text(),
);

await mkdir(outputDir, { recursive: true });
for (const target of selectedTargets) {
  const assetName = targets.get(target);
  const downloadUrl = `${releaseBaseUrl}/${encodeURIComponent(assetName)}`;
  const expectedChecksum = checksums.get(assetName);
  if (!expectedChecksum) {
    throw new Error(`OMP release ${releaseTag} checksums do not contain ${assetName}`);
  }
  await downloadAsset(assetName, downloadUrl, expectedChecksum);
}

console.log(`Synchronized ${selectedTargets.length} OMP binaries from ${releaseTag}`);

import { createHash } from "node:crypto";
import path from "node:path";
import { parseConnectionOfferFromUrl } from "@omp-desktop/protocol/connection-offer";
import { buildRemoteInstallScript } from "./bootstrap-script.js";
import { loadRemoteBackendBundle, type RemoteBackendFile } from "./bundle.js";
import { SshPtySession } from "./pty-session.js";
import type { RemoteSshDeployResult, RemoteSshEvent, RemoteSshStartInput } from "./types.js";
const FILE_CHUNK_BYTES = 512;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

interface RemoteTargetInfo {
  platform: "linux" | "darwin";
  arch: "x64" | "arm64";
  home: string;
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

function parseTargetInfo(value: string): RemoteTargetInfo {
  const [system, machine, encodedHome] = value.split("|");
  const platform = system === "Linux" ? "linux" : system === "Darwin" ? "darwin" : null;
  const arch =
    machine === "x86_64" ? "x64" : machine === "arm64" || machine === "aarch64" ? "arm64" : null;
  if (!platform || !arch || !encodedHome) {
    throw new Error(
      `Unsupported SSH host platform: ${system || "unknown"} ${machine || "unknown"}`,
    );
  }
  return { platform, arch, home: decodeBase64(encodedHome) };
}

export class RemoteSshDeployment {
  private session: SshPtySession | null = null;
  private cancelled = false;

  constructor(
    private readonly input: RemoteSshStartInput,
    private readonly emit: (event: RemoteSshEvent) => void,
  ) {}

  writeInput(input: string): void {
    this.session?.writeInput(input);
  }

  cancel(): void {
    this.cancelled = true;
    this.session?.close();
  }

  async run(): Promise<RemoteSshDeployResult> {
    const operationId = this.input.operationId;
    const token = operationId.replaceAll("-", "");
    const readyMarker = `__OMP_READY_${token}__`;
    this.emit({ operationId, type: "phase", phase: "connecting", message: "Connecting with SSH" });
    this.emit({ operationId, type: "interactive", enabled: true });

    try {
      const bootstrapCommand = `stty -echo; umask 077; OMP_ROOT="$HOME/.omp-desktop/remote-runtime"; OMP_UPLOAD="$OMP_ROOT/uploads/${token}"; mkdir -p "$OMP_UPLOAD"; if printf dGVzdA== | base64 --decode >/dev/null 2>&1; then OMP_B64_DECODE='base64 --decode'; else OMP_B64_DECODE='base64 -D'; fi; export OMP_ROOT OMP_UPLOAD OMP_B64_DECODE; printf '\\n__OMP_READY_%s__%s|%s|%s\\n' '${token}' "$(uname -s)" "$(uname -m)" "$(printf '%s' "$HOME" | base64 | tr -d '\\n')"; exec /bin/sh -i`;
      const bundle = await loadRemoteBackendBundle();
      this.session = new SshPtySession({
        target: this.input.target,
        remoteCommand: bootstrapCommand,
        onTerminal: (data) => this.emit({ operationId, type: "terminal", data }),
      });
      const ready = this.session.waitForLine(readyMarker, 120_000);
      const target = parseTargetInfo(await ready);
      this.session.finishAuthentication();
      this.emit({ operationId, type: "interactive", enabled: false });
      this.emit({
        operationId,
        type: "phase",
        phase: "inspecting",
        message: `Remote host: ${target.platform}-${target.arch}`,
      });
      const targetKey = `${target.platform}-${target.arch}`;
      if (!bundle.supportedTargets.includes(targetKey)) {
        throw new Error(`The packaged backend does not support ${targetKey}`);
      }

      this.emit({
        operationId,
        type: "phase",
        phase: "uploading",
        message: "Uploading verified backend bundle",
      });
      for (const file of bundle.files) {
        this.assertNotCancelled();
        await this.uploadFile(file, token);
      }
      const installScript = Buffer.from(
        buildRemoteInstallScript({
          token,
          backendVersion: bundle.backendVersion,
          nodeVersion: bundle.nodeVersion,
          relayAddress: this.input.relayAddress,
        }),
        "utf8",
      );
      await this.uploadFile(
        {
          relativePath: "install.sh",
          contents: installScript,
        },
        token,
      );

      this.emit({
        operationId,
        type: "phase",
        phase: "preparing-runtime",
        message: `Preparing managed Node.js ${bundle.nodeVersion}`,
      });
      const installingMarker = `__OMP_PHASE_${token}__installing`;
      const startingMarker = `__OMP_PHASE_${token}__starting`;
      const pairingMarker = `__OMP_PHASE_${token}__pairing`;
      const resultMarker = `__OMP_RESULT_${token}__`;
      const errorMarker = `__OMP_ERROR_${token}__`;
      const errorResult = this.session
        .waitForLine(errorMarker, INSTALL_TIMEOUT_MS)
        .then((encoded) => {
          throw new Error(decodeBase64(encoded));
        });
      const waitForPhase = async (
        marker: string,
        phase: "installing" | "starting" | "pairing",
        message: string,
      ): Promise<void> => {
        await Promise.race([this.session!.waitForLine(marker, INSTALL_TIMEOUT_MS), errorResult]);
        this.emit({ operationId, type: "phase", phase, message });
      };
      const result = this.session.waitForLine(resultMarker, INSTALL_TIMEOUT_MS);
      this.session.writeCommand(`sh "$OMP_UPLOAD/install.sh"`);
      await waitForPhase(installingMarker, "installing", "Installing backend dependencies");
      await waitForPhase(startingMarker, "starting", "Starting the remote daemon");
      await waitForPhase(pairingMarker, "pairing", "Generating the encrypted pairing offer");
      const encodedResult = await Promise.race([result, errorResult]);
      const [encodedPair, encodedHostname] = encodedResult.split("|");
      if (!encodedPair || !encodedHostname) throw new Error("Remote pairing result was incomplete");
      const pairing = JSON.parse(decodeBase64(encodedPair)) as { url?: unknown };
      if (typeof pairing.url !== "string") throw new Error("Remote pairing result has no URL");
      const offer = parseConnectionOfferFromUrl(pairing.url);
      if (!offer) throw new Error("Remote pairing URL has no offer");
      if (this.input.expectedServerId && offer.serverId !== this.input.expectedServerId) {
        throw new Error("The SSH target returned a different server ID than the managed host");
      }
      this.emit({ operationId, type: "phase", phase: "complete", message: "Remote daemon ready" });
      return {
        operationId,
        offerUrl: pairing.url,
        hostname: decodeBase64(encodedHostname),
        platform: target.platform,
        arch: target.arch,
        runtimeRoot: path.posix.join(target.home, ".omp-desktop", "remote-runtime"),
        deployedVersion: bundle.backendVersion,
        target: this.input.target,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ operationId, type: "failed", message });
      throw error;
    } finally {
      this.session?.close();
      this.session = null;
    }
  }

  private assertNotCancelled(): void {
    if (this.cancelled) throw new Error("SSH deployment was cancelled");
  }

  private async uploadFile(file: RemoteBackendFile, token: string): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("SSH session is unavailable");
    const relativePath = file.relativePath.replaceAll("\\", "/");
    if (relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
      throw new Error(`Unsafe deployment path: ${relativePath}`);
    }
    const fileToken = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
    const readyMarker = `__OMP_FILE_READY_${token}_${fileToken}__`;
    const ackMarker = `__OMP_FILE_ACK_${token}_${fileToken}__`;
    const doneMarker = `__OMP_FILE_DONE_${token}_${fileToken}__`;
    const endMarker = `__OMP_FILE_END_${token}_${fileToken}__`;
    const expectedHash = createHash("sha256").update(file.contents).digest("hex");
    const remotePath = `$OMP_UPLOAD/${relativePath}`;
    const directory = path.posix.dirname(remotePath);
    const command = `mkdir -p "${directory}"; : > "${remotePath}"; printf '\\n${readyMarker}\\n'; while IFS= read -r OMP_LINE; do [ "$OMP_LINE" = "${endMarker}" ] && break; printf '%s' "$OMP_LINE" | eval "$OMP_B64_DECODE" >> "${remotePath}" || exit 72; printf '\\n${ackMarker}\\n'; done; if command -v sha256sum >/dev/null 2>&1; then OMP_HASH=$(sha256sum "${remotePath}" | awk '{print $1}'); else OMP_HASH=$(shasum -a 256 "${remotePath}" | awk '{print $1}'); fi; [ "$OMP_HASH" = "${expectedHash}" ] || exit 73; printf '\\n${doneMarker}\\n'`;
    const ready = session.waitForLine(readyMarker);
    session.writeCommand(command);
    await ready;
    for (let offset = 0; offset < file.contents.length; offset += FILE_CHUNK_BYTES) {
      this.assertNotCancelled();
      const ack = session.waitForLine(ackMarker);
      session.writeCommand(
        file.contents.subarray(offset, offset + FILE_CHUNK_BYTES).toString("base64"),
      );
      await ack;
    }
    const done = session.waitForLine(doneMarker);
    session.writeCommand(endMarker);
    await done;
  }
}

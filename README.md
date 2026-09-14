# OMP Desktop

An Electron and Web client for [Oh My Pi](https://github.com/can1357/oh-my-pi). It runs a private daemon on your machine and talks to `omp --mode rpc-ui` through OMP's native JSONL RPC protocol. Web clients can control a remote daemon through a self-hosted, end-to-end encrypted relay.

## Requirements

- Node.js from `.tool-versions` and npm workspaces for development and source builds
- `omp >= 16.3.9` on `PATH` for development and standalone daemon runs
- A configured OMP model provider

Packaged macOS, Linux, and Windows applications include OMP and do not require a system OMP installation.

## File drag and drop

- Drop files onto the message input to add attachments without sending a message.
- Drop external UTF-8 text files onto the conversation history or other ordinary areas to open local, read-only file tabs, not a dialog. Each tab offers **Preview / Source** modes; Markdown and HTML render in Preview mode. Files are not uploaded.
  - Outside a workspace, files open on a dedicated preview page with file tabs.
  - Preview tabs and their contents are session-only. Switching tabs retains the selected mode; closing a tab releases its content, and reloading removes local preview tabs.
- Local text previews support files up to 2 MiB, including extensionless files. Directories, binary files, and larger files show an explanation instead.
- Terminal surfaces keep their existing file-path drop behavior.

## Background processes

Background commands started by the current Agent appear beside the workspace branch under the composer. The indicator shows the active count; opening it lists live and recently completed commands. Select a command to open its read-only terminal output in a bottom pane. Closing that pane does not stop the process, and reconnecting restores the process state and retained output.

## Independent agent conversations

Agent-scoped `create_agent` calls create a child agent in the caller's workspace by default.
Set `detached: true` to create an independent conversation instead; `workspaceId` still
selects its workspace and defaults to the caller's workspace when omitted. The independent
agent appears as a workspace root and is not canceled or archived with its creator.
Sharing a workspace does not isolate concurrent file edits.

`notifyOnFinish: true` can notify the creator when an independently created agent finishes,
fails, or needs permission without establishing a parent relationship. Notifications do
not revive an archived creator. Regular child agents retain parent-owned notifications,
which stop if the child is subsequently detached.

## Development

```bash
npm install
npm run dev:desktop
```

Development uses:

- daemon: `127.0.0.1:6770`
- renderer: an available Electron Metro port
- state: `.dev/omp-desktop-home`

The packaged app uses `~/.omp-desktop`. OMP keeps its own configuration, credentials, provider subscriptions, and sessions under `~/.omp`.

## SSH remote hosts

The Electron app can provision a remote daemon from **Settings → General → Add host → Connect via SSH**. It uses the system OpenSSH client, including `~/.ssh/config`, agent identities, `ProxyJump`, host-key verification, passwords, passphrases, and MFA prompts.

SSH is used only to inspect the host, upload the version-matched backend, start the daemon, and obtain its pairing offer. After pairing, SSH closes and the app connects through the configured end-to-end encrypted Relay. The remote daemon remains bound to `127.0.0.1:6770`; do not expose that port to the Internet.

Supported remote targets are glibc Linux and macOS on x64 or arm64. The remote account needs:

- a POSIX shell, `tar`, and either `curl` or `wget`;
- outbound HTTPS access to `nodejs.org` and the npm registry;
- write access to its home directory.

No root access is required. Managed runtime files are installed under `~/.omp-desktop/remote-runtime`, while daemon identity and state remain under `~/.omp-desktop`. OMP itself is installed separately from the paired host's settings.

Remote releases are staged and checksum-verified before an atomic switch. Failed starts roll back to the previous managed release. Hosts provisioned this way update through **Host Settings → Update daemon → Update via SSH** because the workspace packages are bundled with the Desktop application rather than installed from the public npm registry. Removing a Host from the app forgets its local SSH management profile but does not stop or delete the remote daemon.

SSH passwords, private-key passphrases, MFA responses, and pairing links are never persisted. The local management profile stores only the SSH target fields, identity-file path, remote runtime path, server ID, and deployed version. Remote Windows and musl-based Linux distributions such as Alpine are not supported.

## Build

```bash
npm run build:desktop -- --dir
```

The macOS arm64 application is written to:

```text
packages/desktop/release/mac-arm64/OMP Desktop.app
```

Windows installers are produced in separate electron-builder invocations. Build one architecture with:

```bash
npm run build:windows:x64
npm run build:windows:arm64
```

Run `npm run build:windows` to build both sequentially. Publish the resulting `OMP-Desktop-Setup-<version>-x64.exe` and `OMP-Desktop-Setup-<version>-arm64.exe`; no combined installer is produced.

Download and checksum-verify the latest supported OMP binaries:

```bash
npm run download:omp
```

Specific targets can be refreshed without downloading every architecture:

```bash
npm run download:omp -- linux-x64 linux-arm64
```

The script writes these release assets to the repository-root `bin/` directory:

- `omp-darwin-arm64`
- `omp-darwin-x64`
- `omp-linux-arm64`
- `omp-linux-x64`
- `omp-windows-arm64.exe`
- `omp-windows-x64.exe`

electron-builder selects the target architecture and installs the executable as `Resources/bin/omp` on macOS, `resources/bin/omp` on Linux, or `resources/bin/omp.exe` on Windows.

### Bundled skills

The repository-root `skills/` directory is the source catalog for bundled orchestration skills. During the server build, `packages/server/package.json` removes the previous `dist/server/skills` directory and recursively copies `../../skills` into it. This makes the same catalog available to the development server and packaged application.

The directory currently contains only `.gitkeep`, which keeps the otherwise-empty catalog under version control. Keep the `skills/` directory even when no bundled skills are present: removing it causes the recursive copy step to fail. Add future bundled skills as subdirectories containing their `SKILL.md` files.

## Self-hosted Web and relay

The default configuration enables the hosted Relay at `relay.paseo.sh:443` with TLS. Self-hosted deployments can replace that endpoint and do not otherwise depend on a hosted Paseo service.

### Build

```bash
npm install
npm run build:server
npm run build --workspace=@omp-desktop/cli
npm run build:web --workspace=@omp-desktop/app
```

The Web export is `packages/app/dist`. These commands build artifacts; they do not start the daemon.

### Cloudflare Pages

```bash
./deploy.sh
# or: npm run deploy:web
```

`deploy.sh` builds the Web export and runs `wrangler pages deploy` against project `omp-desktop` on branch `main`. Override with `CF_PAGES_PROJECT` / `CF_PAGES_BRANCH` if needed. SPA routes fall back through `packages/app/public/_redirects`. Pairing links should use the Pages origin as `app.baseUrl`.

Deploy the `paseo-relay` repository using its `deployment/self-hosted/compose.yaml`, `Caddyfile`, and `.env.example`. That deployment serves both your WSS relay and the Web export on your own domains, with automatic HTTPS and SPA route fallback. The relay machine does not need OMP or access to the daemon's private listening port.

### Configure the machine running OMP

Merge this configuration into `~/.omp-desktop/config.json`, retaining your other settings. Replace the example domains with those in the relay deployment:

```json
{
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:6770",
    "relay": {
      "enabled": true,
      "endpoint": "relay.example.com:443",
      "useTls": true
    }
  },
  "app": {
    "baseUrl": "https://omp.example.com"
  }
}
```

Start the backend, then obtain a pairing link in another terminal:

```bash
node packages/cli/bin/omp-desktop daemon start --foreground --no-web-ui
node packages/cli/bin/omp-desktop daemon pair --json
```

In the Web app, open **Settings → Connections → Relay server address**. It defaults to `wss://relay.paseo.sh:443`; replace it with `wss://relay.example.com` for a self-hosted deployment. Leave the setting empty only when the browser should use the relay address advertised by each pairing link. An already connected host can generate another link from **Settings → Host → Pair device**. Treat pairing links like passwords: anyone holding one can access that daemon. Legacy placeholder identities require re-pairing after upgrading.

The daemon initiates the outbound connection; do not expose port `6770` to the Internet. Keep `PASEO_APP_BASE_URL` / `app.baseUrl` pointed at your own Web deployment so generated links open the right client.

Environment overrides, useful when the daemon and browser reach different sides of a reverse proxy:

| Environment variable          | Config field                  | Purpose                                                         |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `PASEO_RELAY_ENABLED`         | `daemon.relay.enabled`        | Enable or disable Relay access                                  |
| `PASEO_RELAY_ENDPOINT`        | `daemon.relay.endpoint`       | Relay `host:port` dialed by the daemon                          |
| `PASEO_RELAY_USE_TLS`         | `daemon.relay.useTls`         | Outbound daemon TLS                                             |
| `PASEO_RELAY_PUBLIC_ENDPOINT` | `daemon.relay.publicEndpoint` | Browser-facing relay `host:port`; defaults to outbound endpoint |
| `PASEO_RELAY_PUBLIC_USE_TLS`  | `daemon.relay.publicUseTls`   | Browser-facing TLS; defaults to outbound TLS                    |
| `PASEO_APP_BASE_URL`          | `app.baseUrl`                 | Your Web origin in pairing links                                |

Use `true` / `false` for boolean overrides. Relay endpoints are authorities such as `relay.example.com:443`, without a scheme or `/ws` path. Public HTTPS Web deployments need WSS. Disabling TLS for a trusted local development relay does not disable E2EE.

The relay carries daemon WebSocket traffic, including workspace, agent, and terminal control. It does not tunnel arbitrary HTTP endpoints: file downloads and HTTP service previews still need their own reachable address.

## Workspace packages

- `packages/app` — Electron and Web renderer
- `packages/desktop` — Electron main process and packaging
- `packages/server` — local daemon and OMP adapter
- `packages/client` — daemon client
- `packages/protocol` — shared wire schemas
- `packages/relay` — shared E2EE relay transport
- `packages/cli` — `omp-desktop` CLI
- `packages/highlight` — code and diff highlighting

## Verification

```bash
npm run format
npm run lint
npm run typecheck
```

Run only targeted Vitest files; do not run the full test suite locally.

## License

AGPL-3.0-or-later. This project is derived from Paseo and retains its original Git history and license notices.

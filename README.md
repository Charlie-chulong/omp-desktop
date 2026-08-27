# OMP Desktop

A local Electron client for [Oh My Pi](https://github.com/can1357/oh-my-pi). It runs a private daemon on your machine and talks to `omp --mode rpc-ui` through OMP's native JSONL RPC protocol.

## Requirements

- Node.js from `.tool-versions`
- npm workspaces
- `omp >= 16.3.9` on `PATH`
- A configured OMP model provider

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

## Build

```bash
npm run build:desktop -- --dir
```

The macOS arm64 application is written to:

```text
packages/desktop/release/mac-arm64/OMP Desktop.app
```

## Workspace packages

- `packages/app` — Electron renderer
- `packages/desktop` — Electron main process and packaging
- `packages/server` — local daemon and OMP adapter
- `packages/client` — daemon client
- `packages/protocol` — shared wire schemas
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

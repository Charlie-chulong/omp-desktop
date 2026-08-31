#!/usr/bin/env bash
set -euo pipefail

# npm installs only the host platform's optional dependencies. Cross-building on
# macOS therefore omits the Windows keyring bindings that the packaged daemon
# loads at runtime. Fetch both Windows architectures directly without reifying
# the workspace (which would remove the other architecture).
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for package in \
  @napi-rs/keyring-win32-x64-msvc \
  @napi-rs/keyring-win32-arm64-msvc; do
  archive="$(npm pack --silent --pack-destination "$tmp_dir" "$package@1.3.0")"
  package_dir="node_modules/$package"
  mkdir -p "$package_dir"
  tar -xzf "$tmp_dir/$archive" -C "$package_dir" --strip-components=1
done

npm run build:desktop -- --win

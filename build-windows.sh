#!/usr/bin/env bash
set -euo pipefail

# npm installs only the host platform's optional dependencies. Cross-building on
# macOS therefore omits the Windows keyring bindings that the packaged daemon
# loads at runtime. Fetch both Windows architectures directly without reifying
# the workspace (which would remove the other architecture).
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
keyring_version="$(node -p "require('./node_modules/@napi-rs/keyring/package.json').version")"

for package in \
  @napi-rs/keyring-win32-x64-msvc \
  @napi-rs/keyring-win32-arm64-msvc; do
  archive="$(npm pack --silent --pack-destination "$tmp_dir" "$package@$keyring_version")"
  package_dir="node_modules/$package"
  rm -rf "$package_dir"
  mkdir -p "$package_dir"
  tar -xzf "$tmp_dir/$archive" -C "$package_dir" --strip-components=1
  binding_name="${package#@napi-rs/keyring-}"
  test -f "$package_dir/keyring.$binding_name.node"
done

npm run build:desktop -- --win "$@"

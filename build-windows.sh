#!/usr/bin/env bash
set -euo pipefail

# Windows installers must be built one architecture per electron-builder
# invocation. Passing both architectures in one invocation emits an additional
# universal NSIS installer containing both payloads.
read -r -a arches <<<"${WINDOWS_ARCHES:-x64 arm64}"

for arch in "${arches[@]}"; do
  case "$arch" in
    x64 | arm64) ;;
    *)
      echo "Unsupported Windows architecture: $arch" >&2
      exit 2
      ;;
  esac
done

# npm installs only the host platform's optional dependencies. Cross-building on
# macOS therefore omits the Windows keyring bindings that the packaged daemon
# loads at runtime. Fetch the requested Windows architectures directly without
# reifying the workspace (which would remove the other architecture).
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
keyring_version="$(node -p "require('./node_modules/@napi-rs/keyring/package.json').version")"

for arch in "${arches[@]}"; do
  package="@napi-rs/keyring-win32-${arch}-msvc"
  archive="$(npm pack --silent --pack-destination "$tmp_dir" "$package@$keyring_version")"
  package_dir="node_modules/$package"
  rm -rf "$package_dir"
  mkdir -p "$package_dir"
  tar -xzf "$tmp_dir/$archive" -C "$package_dir" --strip-components=1
  binding_name="${package#@napi-rs/keyring-}"
  test -f "$package_dir/keyring.$binding_name.node"
done

# Do not leave a stale universal installer in release/ after splitting builds.
version="$(node -p "require('./packages/desktop/package.json').version")"
rm -f \
  "packages/desktop/release/OMP-Desktop-Setup-$version.exe" \
  "packages/desktop/release/OMP-Desktop-Setup-$version.exe.blockmap"

for arch in "${arches[@]}"; do
  npm run build:desktop -- --win "--$arch" "$@"
done

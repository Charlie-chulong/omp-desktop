interface RemoteInstallScriptInput {
  token: string;
  backendVersion: string;
  nodeVersion: string;
  relayAddress?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildRemoteInstallScript(input: RemoteInstallScriptInput): string {
  const token = input.token.replaceAll("-", "");
  const relayArguments = input.relayAddress
    ? `--relay-address ${shellQuote(input.relayAddress)}`
    : "";

  return `#!/bin/sh
set -u
umask 077
TOKEN=${shellQuote(token)}
RUNTIME_ROOT="$HOME/.omp-desktop/remote-runtime"
UPLOAD="$RUNTIME_ROOT/uploads/${token}"
RELEASE_NAME=${shellQuote(`${input.backendVersion}-${token}`)}
RELEASE="$RUNTIME_ROOT/releases/$RELEASE_NAME"
CURRENT="$RUNTIME_ROOT/current"
NODE_VERSION=${shellQuote(input.nodeVersion)}
NODE_HOME="$RUNTIME_ROOT/node/v$NODE_VERSION"
PASEO_HOME="$HOME/.omp-desktop"

fail() {
  encoded=$(printf '%s' "$1" | base64 | tr -d '\\n')
  printf '\\n__OMP_ERROR_${token}__%s\\n' "$encoded"
  exit 1
}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) node_target="linux-x64" ;;
  Linux-aarch64|Linux-arm64) node_target="linux-arm64" ;;
  Darwin-x86_64) node_target="darwin-x64" ;;
  Darwin-arm64) node_target="darwin-arm64" ;;
  *) fail "Unsupported remote platform: $(uname -s) $(uname -m)" ;;
esac

mkdir -p "$RUNTIME_ROOT/node" "$RUNTIME_ROOT/releases" || fail "Cannot create runtime directory"
if [ ! -x "$NODE_HOME/bin/node" ]; then
  archive="node-v$NODE_VERSION-$node_target.tar.gz"
  temporary="$RUNTIME_ROOT/node/.install-$TOKEN"
  rm -rf "$temporary"
  mkdir -p "$temporary" || fail "Cannot create Node staging directory"
  url="https://nodejs.org/dist/v$NODE_VERSION/$archive"
  sums_url="https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$temporary/$archive" || fail "Failed to download Node.js"
    curl -fsSL "$sums_url" -o "$temporary/SHASUMS256.txt" || fail "Failed to download Node.js checksums"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$temporary/$archive" || fail "Failed to download Node.js"
    wget -q "$sums_url" -O "$temporary/SHASUMS256.txt" || fail "Failed to download Node.js checksums"
  else
    fail "The remote host needs curl or wget to install Node.js"
  fi
  expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$temporary/SHASUMS256.txt")
  [ -n "$expected" ] || fail "Node.js checksum is unavailable"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$temporary/$archive" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$temporary/$archive" | awk '{ print $1 }')
  fi
  [ "$actual" = "$expected" ] || fail "Node.js checksum verification failed"
  tar -xzf "$temporary/$archive" -C "$temporary" || fail "Failed to extract Node.js"
  extracted="$temporary/node-v$NODE_VERSION-$node_target"
  if [ ! -d "$NODE_HOME" ]; then
    mv "$extracted" "$NODE_HOME" || fail "Failed to install Node.js"
  fi
  rm -rf "$temporary"
fi
NODE="$NODE_HOME/bin/node"
NPM="$NODE_HOME/bin/npm"
[ -x "$NODE" ] || fail "Managed Node.js executable is missing"
[ -x "$NPM" ] || fail "Managed npm executable is missing"

printf '\\n__OMP_PHASE_${token}__installing\\n'
PATH="$NODE_HOME/bin:$PATH" "$NPM" ci --prefix "$UPLOAD" --omit=dev --include=optional >"$UPLOAD/npm-install.log" 2>&1 || fail "Backend dependency installation failed"
[ -f "$UPLOAD/node_modules/@omp-desktop/cli/bin/omp-desktop" ] || fail "Installed backend CLI is missing"

running_pid=""
if [ -f "$PASEO_HOME/omp-desktop.pid" ]; then
  running_pid=$("$NODE" -e "try{const x=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(Number.isInteger(x.pid))process.stdout.write(String(x.pid))}catch{}" "$PASEO_HOME/omp-desktop.pid")
fi
old_release=""
if [ -n "$running_pid" ] && kill -0 "$running_pid" 2>/dev/null; then
  if [ ! -f "$RUNTIME_ROOT/managed.json" ] || [ ! -L "$CURRENT" ]; then
    fail "A daemon not managed by SSH deployment is already running"
  fi
  old_release=$(readlink "$CURRENT")
  old_cli="$CURRENT/node_modules/@omp-desktop/cli/bin/omp-desktop"
  PATH="$NODE_HOME/bin:$PATH" "$NODE" "$old_cli" daemon stop --home "$PASEO_HOME" >/dev/null 2>&1 || fail "Failed to stop the existing managed daemon"
fi

mv "$UPLOAD" "$RELEASE" || fail "Failed to activate backend release"
next_link="$RUNTIME_ROOT/.current-$TOKEN"
ln -s "$RELEASE" "$next_link" || fail "Failed to prepare backend release link"
mv -f "$next_link" "$CURRENT" || fail "Failed to switch backend release"
CLI="$CURRENT/node_modules/@omp-desktop/cli/bin/omp-desktop"

printf '\\n__OMP_PHASE_${token}__starting\\n'
PATH="$NODE_HOME/bin:$PATH" PASEO_DESKTOP_MANAGED=1 "$NODE" "$CLI" daemon start --home "$PASEO_HOME" --listen 127.0.0.1:6770 --relay --no-web-ui >/dev/null 2>&1 || start_failed=1
if [ "\${start_failed:-0}" = "1" ]; then
  if [ -n "$old_release" ]; then
    rollback_link="$RUNTIME_ROOT/.rollback-$TOKEN"
    ln -s "$old_release" "$rollback_link" && mv -f "$rollback_link" "$CURRENT"
    old_cli="$CURRENT/node_modules/@omp-desktop/cli/bin/omp-desktop"
    PATH="$NODE_HOME/bin:$PATH" PASEO_DESKTOP_MANAGED=1 "$NODE" "$old_cli" daemon start --home "$PASEO_HOME" --listen 127.0.0.1:6770 --relay --no-web-ui >/dev/null 2>&1 || true
  fi
  fail "Failed to start the deployed daemon"
fi

printf '\\n__OMP_PHASE_${token}__pairing\\n'
pair_json=""
attempt=0
while [ "$attempt" -lt 30 ]; do
  pair_json=$(PATH="$NODE_HOME/bin:$PATH" "$NODE" "$CLI" daemon pair --home "$PASEO_HOME" --relay ${relayArguments} --json 2>/dev/null) && break
  attempt=$((attempt + 1))
  sleep 1
done
if [ -z "$pair_json" ]; then
  PATH="$NODE_HOME/bin:$PATH" "$NODE" "$CLI" daemon stop --home "$PASEO_HOME" >/dev/null 2>&1 || true
  if [ -n "$old_release" ]; then
    rollback_link="$RUNTIME_ROOT/.rollback-$TOKEN"
    ln -s "$old_release" "$rollback_link" && mv -f "$rollback_link" "$CURRENT"
    old_cli="$CURRENT/node_modules/@omp-desktop/cli/bin/omp-desktop"
    PATH="$NODE_HOME/bin:$PATH" PASEO_DESKTOP_MANAGED=1 "$NODE" "$old_cli" daemon start --home "$PASEO_HOME" --listen 127.0.0.1:6770 --relay --no-web-ui >/dev/null 2>&1 || true
  fi
  fail "The deployed daemon did not become ready"
fi
server_id=$(printf '%s' "$pair_json" | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);const u=new URL(x.url);const raw=u.hash.slice('#offer='.length).replace(/-/g,'+').replace(/_/g,'/');const o=JSON.parse(Buffer.from(raw,'base64url'));process.stdout.write(o.serverId)})") || fail "Pairing result was invalid"
if [ -n ${shellQuote(input.backendVersion)} ]; then
  printf '{"version":1,"serverId":"%s","backendVersion":"%s"}\\n' "$server_id" ${shellQuote(input.backendVersion)} >"$RUNTIME_ROOT/managed.json"
fi
hostname_value=$(hostname 2>/dev/null || uname -n)
encoded_pair=$(printf '%s' "$pair_json" | base64 | tr -d '\\n')
encoded_hostname=$(printf '%s' "$hostname_value" | base64 | tr -d '\\n')
printf '\\n__OMP_RESULT_${token}__%s|%s\\n' "$encoded_pair" "$encoded_hostname"
`;
}

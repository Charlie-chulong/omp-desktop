# SSH remote hosts

The Desktop app can provision a remote daemon from **Settings → General → Add host → Connect via SSH**. It uses the system OpenSSH client, including `~/.ssh/config`, agent identities, `ProxyJump`, host-key verification, passwords, passphrases, and MFA prompts.

## Connection and security model

SSH is used only to inspect the host, upload the version-matched backend, start the daemon, and obtain its pairing offer. After pairing, SSH closes and the app connects through the configured end-to-end encrypted Relay. The remote daemon remains bound to `127.0.0.1:6770`; **do not expose that port to the Internet**.

SSH passwords, private-key passphrases, MFA responses, and pairing links are never persisted. The local management profile stores only the SSH target fields, identity-file path, remote runtime path, server ID, and deployed version.

See [self-hosted Web and relay deployment](deployment.md) for relay configuration, browser-facing addresses, and pairing-link precautions.

## Supported hosts and prerequisites

Supported remote targets are **glibc Linux and macOS on x64 or arm64**. Remote Windows and musl-based Linux distributions such as Alpine are not supported.

The remote account needs:

- a POSIX shell, `tar`, and either `curl` or `wget`;
- outbound HTTPS access to `nodejs.org` and the npm registry;
- write access to its home directory.

No root access is required. Managed runtime files are installed under `~/.omp-desktop/remote-runtime`, while daemon identity and state remain under `~/.omp-desktop`. OMP itself is installed separately from the paired host's settings.

## Managed releases and updates

Remote releases are staged and checksum-verified before an atomic switch. Failed starts roll back to the previous managed release.

Hosts provisioned this way update through **Host Settings → Update daemon → Update via SSH** because the workspace packages are bundled with the Desktop application rather than installed from the public npm registry. See [development](development.md#workspace-packages) for the package map and [packaging](packaging.md) for Desktop release construction.

Removing a Host from the app forgets its local SSH management profile but **does not stop or delete the remote daemon**.

# MonoNode daemon

Runs customer servers on a node. Replaces the AirLink daemon: **no npm runtime dependencies**, hardened, and it works on any kind of VPS.

## Requirements
Node.js 20+ and (optional) one of: Docker, Podman, or `bubblewrap` for the native sandbox. `tar` (and `unzip` for zip extraction) must be installed for backups/extract.

## Install
In the panel: **Admin → Nodes → Add node**, then run the command it shows, e.g.

```sh
cd daemon && npm install && npm run build && npm run configure -- --panel https://panel.example.com --key <secret> --port 3002 --allow <panel-ip> && npm start
```

`configure` writes `.env` with mode 600. Keep the secret private; rotate it from the panel at any time.
Run it as a dedicated unprivileged user (add that user to the `docker` group for Docker). A systemd unit:

```ini
[Service]
User=mono
WorkingDirectory=/opt/mono/daemon
ExecStart=/usr/bin/node dist/index.js
Restart=always
NoNewPrivileges=true
```

## Runtimes
`RUNTIME=auto` (default) tries the Docker socket, then Podman, then the native sandbox.

| Setting | Meaning |
|---|---|
| `CONTAINER_SOCKET` | `/var/run/docker.sock`, `/run/podman/podman.sock`, `//./pipe/docker_engine` (Windows) |
| `OCI_RUNTIME=runsc` | gVisor (also `kata`, `sysbox-runc`) for stronger isolation |
| `RUNTIME=process` | no container engine (OpenVZ/LXC/Termux/tiny VPS). Install `bubblewrap` for namespace + read-only-root isolation |

## Security model
* Every request is HMAC-signed (timestamp + single-use nonce + hash of the exact body). No signature, no answer.
* Set `ALLOWED_IPS` to the panel's IP and use `TLS_CERT`/`TLS_KEY` (or a private network) when crossing the internet.
* Server ids are validated; file paths are confined to the server volume (symlinks refused); downloads block private addresses.
* Containers drop all capabilities, forbid privilege escalation, and are limited in RAM, swap, CPU and processes. Disk quota is enforced by the daemon.

## SFTP (optional)
Set `SFTP_PORT` (or `--sftp 2022` with `configure`) and run `npm install` (installs the optional `ssh2` package). Users log in as `<panel-username>.<server-id8>` with the password they create in the panel. A login only ever sees one server's files; symlinks are not followed, writes respect the disk quota, and shell/exec are refused. Without `ssh2` the daemon logs a warning and runs without SFTP.

## Node switching and addons
The panel can move a server between nodes (streamed, checksum-verified, rolled back on failure) and install addon files. Both use signed daemon routes; addon downloads are SSRF-guarded (set `ALLOW_PRIVATE_DOWNLOADS=true` only for testing). `MAX_TRANSFER_MB` caps the compressed size a node will accept.

## Test
`npm test` starts two temporary daemons and runs ~90 checks: authentication, traversal and symlink defence, quotas, console, backups, two-node transfer (including tampered/truncated/downgraded requests), addon installs, the SSRF guard and the SFTP filesystem core.

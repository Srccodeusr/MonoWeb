# MonoVPS Daemon (v1.1.0)

Zero-dependency Node agent that runs customer VPSes as Docker containers (sshd inside, root login, resource limits) and exposes a signed HTTP API to the MonoWeb VPS panel.
Same HMAC request signing as the MonoNode game-server daemon (`ts / nonce / METHOD / path?query / sha256(body)`), 60 s window, single-use nonces.

## Install on a node (Debian/Ubuntu)
MonoWeb → **Admin → VPS → Nodes → Add node** shows a one-line command containing the node's secret. From this folder on the node:

    sudo bash install.sh --panel https://your-panel --key <SECRET> [--port 3100] [--allow <panel-ip>]

It installs Docker + Node 20 if missing, writes `.env` (mode 600) and starts a `monovps-daemon` systemd service. Manual: `npm run configure -- --panel <url> --key <secret>` then `npm start`.
Open the daemon port (default **3100**) to the panel IP only, and the SSH port range you gave the node (default **42000-42999**) to the world.
The game-server daemon uses 20000-40000 by default, so keep the VPS range outside that when both run on one machine.

## Upgrading from 1.0.x
Drop the new files in and restart (`systemctl restart monovps-daemon`). Running VPSes are untouched and keep working.
New deploys/reinstalls build `mono-vps/<os>:2-<hash>` images on first use (a few minutes, once per node and OS); the old `mono-vps/<os>` images stay cached and can be removed with `docker rmi` once no container uses them.
New: `GET /v1/vps` (used by Admin > VPS > Nodes > Reconcile), `POST /v1/vps/:id/resize`, disk/VPS counts in `/v1/system`, custom `base` images, and `create` now reports `diskEnforced`.

## API
`GET /v1/ping`, `/v1/system` (now with disk + VPS counts) · `GET /v1/vps` list · `POST /v1/vps` create (`reinstall:true` to rebuild; optional `base` image) · `GET /v1/vps/:id` state + live stats · `DELETE`
`POST …/power` start/stop/restart/kill · `POST …/resize` live CPU/RAM change · `GET …/logs` · `POST …/exec` · files list/read/write/mkdir/rename/delete · `POST …/password` · `GET|POST …/sshx`.

## Notes
- Disk limit uses `--storage-opt size=` (needs overlay2 on xfs with `pquota`). If unsupported the VPS is created without a hard disk cap and `create` returns `diskEnforced:false` (the panel shows a warning in Admin).
- `OCI_RUNTIME=sysbox-runc` (or `runsc`) is recommended so customers can run Docker/systemd inside their VPS with stronger isolation.
- Base images must be Debian/Ubuntu family (apt installs sshd) and match `ALLOWED_BASE_PREFIXES`.
- `RUNTIME=mock` simulates VPSes in memory for development without Docker. Never use it in production.
- Bandwidth caps are not enforced by Docker; treat the plan's bandwidth as a fair-use label unless you add tc/traffic accounting on the host.

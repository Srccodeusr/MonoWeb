#!/usr/bin/env bash
# MonoVPS daemon installer (Debian/Ubuntu).
# Usage: sudo bash install.sh --panel https://panel.example.com --key <SECRET> [--port 3100] [--allow <panel-ip>]
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
case " $* " in *" --panel "*) ;; *) echo "Missing --panel <url>. Copy the full command from Admin > VPS > Nodes."; exit 1;; esac
case " $* " in *" --key "*) ;; *) echo "Missing --key <secret>."; exit 1;; esac
DIR=/opt/monovps-daemon
SRC="$(cd "$(dirname "$0")" && pwd)"
command -v docker >/dev/null || { echo "Installing Docker..."; curl -fsSL https://get.docker.com | sh; }
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
fi
mkdir -p "$DIR"
if [ "$SRC" != "$DIR" ]; then cp -r "$SRC/." "$DIR/"; fi
cd "$DIR"
node src/configure.js "$@"
cat > /etc/systemd/system/monovps-daemon.service <<UNIT
[Unit]
Description=MonoVPS daemon
After=network-online.target docker.service
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now monovps-daemon
systemctl restart monovps-daemon
echo "MonoVPS daemon running. Open the daemon port (default 3100, restrict it to the panel IP) and the SSH port range from Admin > VPS > Nodes."
echo "NOTE: Docker publishes container ports straight through iptables and bypasses ufw. Restrict the daemon port with your provider firewall or --allow <panel-ip>."

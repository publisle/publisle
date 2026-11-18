#!/usr/bin/env bash
# Provisions the Publisle API endpoint on a fresh Debian/Ubuntu VPS (OVH).
# Usage: sudo ./install.sh
# Prereqs: DNS A/AAAA record api.publisle.xyz -> this server; ports 22/80/443 open.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

APP_DIR=/opt/publisle-api
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg

echo "==> Node.js 24"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi
node --version

echo "==> Edge reverse proxy"
# A shared VPS may already serve 80/443 with another proxy (for example a
# Dockerized nginx). Caddy is installed only when it already owns the edge or
# the ports are free; otherwise integrate the API host into the existing proxy
# manually and skip this section.
EDGES_FREE=1
if ss -ltn | awk '{print $4}' | grep -qE ':(80|443)$'; then EDGES_FREE=0; fi
if command -v caddy >/dev/null 2>&1 || [[ "$EDGES_FREE" == 1 ]]; then
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy
  fi
  caddy --version
else
  echo "Ports 80/443 already serve an existing edge without Caddy; skipping Caddy installation."
  echo "Proxy api.publisle.xyz to 127.0.0.1:8787 (or PDF_BIND) with 256KiB request bodies and >=220s response timeout."
fi

echo "==> Rootless runtime prerequisites"
command -v docker >/dev/null || { echo "Install Docker Engine CLI and rootless extras using the official Docker Debian/Ubuntu instructions first." >&2; exit 1; }
command -v dockerd-rootless-setuptool.sh >/dev/null || { echo "Install docker-ce-rootless-extras first." >&2; exit 1; }
[[ -f /sys/fs/cgroup/cgroup.controllers ]] || { echo "cgroup v2 is required." >&2; exit 1; }
apt-get install -y -qq uidmap dbus-user-session slirp4netns

echo "==> Dedicated user and resource hierarchy"
id -u publisle >/dev/null 2>&1 || useradd --system --home /var/lib/publisle-runtime --shell /usr/sbin/nologin publisle
SERVICE_UID="$(id -u publisle)"
install -d -o publisle -g publisle -m 0700 /var/lib/publisle-runtime
systemctl stop publisle-api.service 2>/dev/null || true
if [[ "$(getent passwd publisle | cut -d: -f6)" != /var/lib/publisle-runtime ]]; then
  usermod --home /var/lib/publisle-runtime publisle
fi
if ! awk -F: '$1 == "publisle" { found=1 } END { exit !found }' /etc/subuid; then
  SUBID_START="$(awk -F: 'BEGIN { nextid=100000 } { end=$2+$3; if(end>nextid) nextid=end } END { print nextid }' /etc/subuid /etc/subgid)"
  usermod --add-subuids "$SUBID_START-$((SUBID_START + 65535))" --add-subgids "$SUBID_START-$((SUBID_START + 65535))" publisle
fi
node "$SCRIPT_DIR/write-slice.mjs" /etc/systemd/system/publisle-pdf.slice /etc/publisle-pdf-budget.json
chmod 0644 /etc/systemd/system/publisle-pdf.slice /etc/publisle-pdf-budget.json
# Rootless containers are placed by runc directly inside the delegated daemon
# subtree; the systemd cgroup driver would require polkit grants for the
# daemon's non-login scope creation on stricter distributions.
install -d -o publisle -g publisle -m 0755 /var/lib/publisle-runtime/.config/docker
install -o publisle -g publisle -m 0644 /dev/null /var/lib/publisle-runtime/.config/docker/daemon.json
printf '%s\n' '{"exec-opts": ["native.cgroupdriver=cgroupfs"]}' > /var/lib/publisle-runtime/.config/docker/daemon.json
install -d "/etc/systemd/system/user@$SERVICE_UID.service.d"
cat > "/etc/systemd/system/user@$SERVICE_UID.service.d/publisle-pdf.conf" <<'UNIT'
[Service]
Slice=publisle-pdf.slice
Delegate=cpu cpuset io memory pids
UNIT
systemctl daemon-reload
loginctl enable-linger publisle
systemctl restart "user@$SERVICE_UID.service"
RUNTIME_DIR="/run/user/$SERVICE_UID"
runuser -u publisle -- env HOME=/var/lib/publisle-runtime XDG_RUNTIME_DIR="$RUNTIME_DIR" DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus" dockerd-rootless-setuptool.sh install --force

echo "==> API files"
install -d -o root -g root "$APP_DIR"
for FILE in server.mjs limits.mjs queue.mjs images.mjs worker.mjs reap.mjs budget.mjs mcp.mjs; do
  # mcp.mjs is a build output (pnpm --filter @publisle/mcp build); copy it to
  # deploy/vps/ first to enable /mcp. Without it the API answers 503 there.
  [[ $FILE != mcp.mjs || -f "$SCRIPT_DIR/$FILE" ]] || continue
  install -o root -g root -m 0644 "$SCRIPT_DIR/$FILE" "$APP_DIR/$FILE"
done
install -m 0644 "$SCRIPT_DIR/publisle-api.service" /etc/systemd/system/publisle-api.service
if [[ ! -f /etc/publisle-api.env ]]; then
  cat > /etc/publisle-api.env <<ENV
PDF_ENABLED=false
PDF_WORKER_IMAGE=
PDF_ORIGINS=https://publisle.xyz
PDF_ASSET_BASE=https://publisle.xyz/
# Content-addressed PDF cache; repeat compiles of an identical document skip
# the container run. Entries expire after PDF_CACHE_TTL_MS (default 1 hour).
PDF_CACHE_DIR=/var/lib/publisle-pdf/cache
HOME=/var/lib/publisle-runtime
XDG_RUNTIME_DIR=$RUNTIME_DIR
DOCKER_HOST=unix://$RUNTIME_DIR/docker.sock
ENV
  chmod 0640 /etc/publisle-api.env
fi

if command -v caddy >/dev/null 2>&1; then
  echo "==> Caddy configuration"
  install -d /etc/caddy/conf.d
  # Keep other hosted services and existing firewall rules intact.
  if ! grep -q 'api\.publisle\.xyz' /etc/caddy/Caddyfile 2>/dev/null; then
    install -m 0644 "$SCRIPT_DIR/Caddyfile" /etc/caddy/conf.d/publisle-api.caddy
    if ! grep -q '^import /etc/caddy/conf.d/\*.caddy' /etc/caddy/Caddyfile; then
      echo 'import /etc/caddy/conf.d/*.caddy' >> /etc/caddy/Caddyfile
    fi
  else
    echo "Existing API host found; review its proxy and timeouts against the supplied Caddyfile."
  fi
  caddy validate --config /etc/caddy/Caddyfile
fi

echo "==> Start disabled API"
systemctl daemon-reload
systemctl enable --now publisle-api.service
if command -v caddy >/dev/null 2>&1; then systemctl reload caddy; fi
# The service needs a moment to bind; retry the readiness endpoint.
curl -fsS --retry 15 --retry-connrefused --retry-delay 1 http://127.0.0.1:8787/health
echo
echo "==> Load the worker image into publisle's rootless runtime, verify aggregate limits, then configure PDF_WORKER_IMAGE. PDF remains disabled on first installation."

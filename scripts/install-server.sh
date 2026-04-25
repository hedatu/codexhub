#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-/opt/codexhub}"
SERVICE_USER="${CODEXHUB_USER:-codexhub}"
PORT="${CODEXHUB_PORT:-8787}"
HOST="${CODEXHUB_HOST:-127.0.0.1}"
ADMIN_TOKEN="${CODEXHUB_ADMIN_TOKEN:-$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')}"
INSTALL_KEY="${CODEXHUB_INSTALL_KEY:-$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js first." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root so it can create a systemd service." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$INSTALL_DIR"
rsync -a --delete \
  --exclude node_modules \
  --exclude codexhub-state.json \
  "$REPO_ROOT/" "$INSTALL_DIR/"

cat > "$INSTALL_DIR/codexhub.env" <<EOF_ENV
CODEXHUB_PORT=$PORT
CODEXHUB_HOST=$HOST
CODEXHUB_ADMIN_TOKEN=$ADMIN_TOKEN
CODEXHUB_INSTALL_KEY=$INSTALL_KEY
CODEXHUB_DATA_FILE=$INSTALL_DIR/codexhub-state.json
EOF_ENV

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

cat > /etc/systemd/system/codexhub.service <<EOF_SERVICE
[Unit]
Description=CodexHub cloud server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/codexhub.env
ExecStart=$(command -v node) $INSTALL_DIR/src/server/cloud-server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF_SERVICE

systemctl daemon-reload
systemctl enable --now codexhub.service

echo "CodexHub server installed."
echo "Local URL: http://127.0.0.1:$PORT"
echo "ADMIN_TOKEN=$ADMIN_TOKEN"
echo "INSTALL_KEY=$INSTALL_KEY"
echo "Put Nginx/Caddy HTTPS in front of http://127.0.0.1:$PORT"

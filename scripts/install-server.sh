#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-/opt/codexhub}"
SERVICE_USER="${CODEXHUB_USER:-codexhub}"
PORT="${CODEXHUB_PORT:-8787}"
HOST="${CODEXHUB_HOST:-127.0.0.1}"
PUBLIC_URL="${CODEXHUB_PUBLIC_URL:-}"
ADMIN_TOKEN="${CODEXHUB_ADMIN_TOKEN:-$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')}"
INSTALL_KEY="${CODEXHUB_INSTALL_KEY:-$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')}"

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
CODEXHUB_PUBLIC_URL=$PUBLIC_URL
CODEXHUB_ADMIN_TOKEN=$ADMIN_TOKEN
CODEXHUB_INSTALL_KEY=$INSTALL_KEY
CODEXHUB_DATA_FILE=$INSTALL_DIR/codexhub-state.json
EOF_ENV

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) GO_ARCH="amd64" ;;
  aarch64|arm64) GO_ARCH="arm64" ;;
  i386|i686) GO_ARCH="386" ;;
  *) GO_ARCH="" ;;
esac

SERVER_EXEC=""
if [ -n "$GO_ARCH" ] && [ -x "$INSTALL_DIR/bin/codexhub-server-linux-$GO_ARCH" ]; then
  SERVER_EXEC="$INSTALL_DIR/bin/codexhub-server-linux-$GO_ARCH"
elif [ -x "$INSTALL_DIR/bin/codexhub-server" ]; then
  SERVER_EXEC="$INSTALL_DIR/bin/codexhub-server"
fi

if [ -n "$SERVER_EXEC" ]; then
  chmod +x "$SERVER_EXEC"
  EXEC_START="$SERVER_EXEC"
else
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 20+ is required when the Go server binary is not packaged." >&2
    exit 1
  fi
  EXEC_START="$(command -v node) $INSTALL_DIR/src/server/cloud-server.mjs"
fi

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
ExecStart=$EXEC_START
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

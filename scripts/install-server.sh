#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-/opt/codexhub}"
EXISTING_ENV_FILE="$INSTALL_DIR/codexhub.env"

env_file_value() {
  local key="$1"
  if [ -f "$EXISTING_ENV_FILE" ]; then
    grep -E "^${key}=" "$EXISTING_ENV_FILE" | tail -n 1 | cut -d= -f2- || true
  fi
}

SERVICE_USER="${CODEXHUB_USER:-codexhub}"
PORT="${CODEXHUB_PORT:-$(env_file_value CODEXHUB_PORT)}"
PORT="${PORT:-8787}"
HOST="${CODEXHUB_HOST:-$(env_file_value CODEXHUB_HOST)}"
HOST="${HOST:-127.0.0.1}"
PUBLIC_URL="${CODEXHUB_PUBLIC_URL:-$(env_file_value CODEXHUB_PUBLIC_URL)}"
PUBLIC_URL="${PUBLIC_URL:-}"
ADMIN_TOKEN="${CODEXHUB_ADMIN_TOKEN:-$(env_file_value CODEXHUB_ADMIN_TOKEN)}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')}"
INSTALL_KEY="${CODEXHUB_INSTALL_KEY:-$(env_file_value CODEXHUB_INSTALL_KEY)}"
INSTALL_KEY="${INSTALL_KEY:-$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')}"
STORAGE="${CODEXHUB_STORAGE:-$(env_file_value CODEXHUB_STORAGE)}"
STORAGE="${STORAGE:-sqlite}"
DATA_DIR="${CODEXHUB_DATA_DIR:-$INSTALL_DIR/data}"
BACKUP_DIR="${CODEXHUB_BACKUP_DIR:-$(env_file_value CODEXHUB_BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-$INSTALL_DIR/backups}"
BACKUP_RETENTION_DAYS="${CODEXHUB_BACKUP_RETENTION_DAYS:-$(env_file_value CODEXHUB_BACKUP_RETENTION_DAYS)}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
SQLITE_MIN_PERSIST_MS="${CODEXHUB_SQLITE_MIN_PERSIST_MS:-$(env_file_value CODEXHUB_SQLITE_MIN_PERSIST_MS)}"
SQLITE_MIN_PERSIST_MS="${SQLITE_MIN_PERSIST_MS:-15000}"
REPORT_TZ_OFFSET_MINUTES="${CODEXHUB_REPORT_TZ_OFFSET_MINUTES:-$(env_file_value CODEXHUB_REPORT_TZ_OFFSET_MINUTES)}"
REPORT_TZ_OFFSET_MINUTES="${REPORT_TZ_OFFSET_MINUTES:-480}"
PUSH_WEBHOOK_URL="${CODEXHUB_PUSH_WEBHOOK_URL:-$(env_file_value CODEXHUB_PUSH_WEBHOOK_URL)}"
FCM_SERVICE_ACCOUNT_FILE="${CODEXHUB_FCM_SERVICE_ACCOUNT_FILE:-$(env_file_value CODEXHUB_FCM_SERVICE_ACCOUNT_FILE)}"
FCM_SERVICE_ACCOUNT_JSON="${CODEXHUB_FCM_SERVICE_ACCOUNT_JSON:-$(env_file_value CODEXHUB_FCM_SERVICE_ACCOUNT_JSON)}"
FCM_PROJECT_ID="${CODEXHUB_FCM_PROJECT_ID:-$(env_file_value CODEXHUB_FCM_PROJECT_ID)}"
FIREBASE_WEB_CONFIG="${CODEXHUB_FIREBASE_WEB_CONFIG:-$(env_file_value CODEXHUB_FIREBASE_WEB_CONFIG)}"
FIREBASE_VAPID_KEY="${CODEXHUB_FIREBASE_VAPID_KEY:-$(env_file_value CODEXHUB_FIREBASE_VAPID_KEY)}"
RELEASE_MANIFEST_URL="${CODEXHUB_RELEASE_MANIFEST_URL:-$(env_file_value CODEXHUB_RELEASE_MANIFEST_URL)}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root so it can create a systemd service." >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y sqlite3
  else
    echo "sqlite3 was not found. Install sqlite3 or set CODEXHUB_STORAGE=json before starting CodexHub." >&2
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$BACKUP_DIR"
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
CODEXHUB_STORAGE=$STORAGE
CODEXHUB_SQLITE_FILE=$DATA_DIR/codexhub.db
CODEXHUB_SQLITE_MIN_PERSIST_MS=$SQLITE_MIN_PERSIST_MS
CODEXHUB_BACKUP_DIR=$BACKUP_DIR
CODEXHUB_BACKUP_RETENTION_DAYS=$BACKUP_RETENTION_DAYS
CODEXHUB_REPORT_TZ_OFFSET_MINUTES=$REPORT_TZ_OFFSET_MINUTES
CODEXHUB_PUSH_WEBHOOK_URL=$PUSH_WEBHOOK_URL
CODEXHUB_FCM_SERVICE_ACCOUNT_FILE=$FCM_SERVICE_ACCOUNT_FILE
CODEXHUB_FCM_SERVICE_ACCOUNT_JSON=$FCM_SERVICE_ACCOUNT_JSON
CODEXHUB_FCM_PROJECT_ID=$FCM_PROJECT_ID
CODEXHUB_FIREBASE_WEB_CONFIG=$FIREBASE_WEB_CONFIG
CODEXHUB_FIREBASE_VAPID_KEY=$FIREBASE_VAPID_KEY
CODEXHUB_RELEASE_MANIFEST_URL=$RELEASE_MANIFEST_URL
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
if [ -n "$GO_ARCH" ] && [ -f "$INSTALL_DIR/bin/codexhub-server-linux-$GO_ARCH" ]; then
  SERVER_EXEC="$INSTALL_DIR/bin/codexhub-server-linux-$GO_ARCH"
elif [ -f "$INSTALL_DIR/bin/codexhub-server" ]; then
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

cat > /etc/systemd/system/codexhub-backup.service <<EOF_BACKUP_SERVICE
[Unit]
Description=CodexHub server backup

[Service]
Type=oneshot
User=$SERVICE_USER
EnvironmentFile=$INSTALL_DIR/codexhub.env
ExecStart=$INSTALL_DIR/scripts/backup-server.sh
EOF_BACKUP_SERVICE

cat > /etc/systemd/system/codexhub-backup.timer <<EOF_BACKUP_TIMER
[Unit]
Description=Run CodexHub backup daily

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true

[Install]
WantedBy=timers.target
EOF_BACKUP_TIMER

systemctl daemon-reload
systemctl enable --now codexhub-backup.timer

echo "CodexHub server installed."
echo "Local URL: http://127.0.0.1:$PORT"
echo "ADMIN_TOKEN=$ADMIN_TOKEN"
echo "INSTALL_KEY=$INSTALL_KEY"
echo "SQLite: $DATA_DIR/codexhub.db"
echo "Backups: $BACKUP_DIR"
echo "Put Nginx/Caddy HTTPS in front of http://127.0.0.1:$PORT"

#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-/opt/codexhub}"
ENV_FILE="${CODEXHUB_ENV_FILE:-$INSTALL_DIR/codexhub.env}"
BACKUP_DIR="${CODEXHUB_BACKUP_DIR:-$INSTALL_DIR/backups}"
RETENTION_DAYS="${CODEXHUB_BACKUP_RETENTION_DAYS:-30}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

DATA_FILE="${CODEXHUB_DATA_FILE:-$INSTALL_DIR/codexhub-state.json}"
SQLITE_FILE="${CODEXHUB_SQLITE_FILE:-$INSTALL_DIR/data/codexhub.db}"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
TARGET="$BACKUP_DIR/$STAMP"

mkdir -p "$TARGET"

if [ -f "$DATA_FILE" ]; then
  cp "$DATA_FILE" "$TARGET/codexhub-state.json"
fi

if [ -f "$SQLITE_FILE" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$SQLITE_FILE" ".backup '$TARGET/codexhub.db'"
  else
    cp "$SQLITE_FILE" "$TARGET/codexhub.db"
  fi
fi

cat > "$TARGET/manifest.json" <<EOF_JSON
{
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "host": "$(hostname)",
  "installDir": "$INSTALL_DIR",
  "dataFile": "$DATA_FILE",
  "sqliteFile": "$SQLITE_FILE"
}
EOF_JSON

tar -C "$BACKUP_DIR" -czf "$BACKUP_DIR/codexhub-backup-$STAMP.tar.gz" "$STAMP"
rm -rf "$TARGET"

find "$BACKUP_DIR" -name 'codexhub-backup-*.tar.gz' -type f -mtime +"$RETENTION_DAYS" -delete

echo "CodexHub backup created: $BACKUP_DIR/codexhub-backup-$STAMP.tar.gz"

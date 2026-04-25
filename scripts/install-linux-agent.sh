#!/usr/bin/env bash
set -euo pipefail

SERVER=""
INSTALL_KEY=""
NODE_ID="$(hostname)"
NODE_NAME="$NODE_ID"
FARFIELD_URL="http://127.0.0.1:4311"
INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-$HOME/.local/share/codexhub}"
CONFIG_DIR="${CODEXHUB_CONFIG_DIR:-$HOME/.config/codexhub}"
NO_SYSTEMD=0
NO_FARFIELD=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --install-key) INSTALL_KEY="$2"; shift 2 ;;
    --node-id) NODE_ID="$2"; shift 2 ;;
    --node-name) NODE_NAME="$2"; shift 2 ;;
    --farfield-url) FARFIELD_URL="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --no-systemd) NO_SYSTEMD=1; shift ;;
    --no-farfield) NO_FARFIELD=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$SERVER" ] || [ -z "$INSTALL_KEY" ]; then
  echo "Usage: $0 --server https://hub.example.com --install-key KEY [--node-id NAME] [--node-name NAME]" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required." >&2
  exit 1
fi

if [ "$NO_FARFIELD" -eq 0 ] && ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run Farfield." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_SOURCE="$REPO_ROOT/src/desktop-agent/agent.mjs"

mkdir -p "$INSTALL_DIR/src/desktop-agent" "$CONFIG_DIR"
cp "$AGENT_SOURCE" "$INSTALL_DIR/src/desktop-agent/agent.mjs"

CONFIG_PATH="$CONFIG_DIR/agent.json"
cat > "$CONFIG_PATH" <<EOF_JSON
{
  "server": "${SERVER%/}",
  "installKey": "$INSTALL_KEY",
  "nodeId": "$NODE_ID",
  "nodeName": "$NODE_NAME",
  "farfieldUrl": "${FARFIELD_URL%/}",
  "provider": "codex",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF_JSON
chmod 600 "$CONFIG_PATH"

if [ "$NO_SYSTEMD" -eq 0 ]; then
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found; installed files only. Run with node manually." >&2
  else
    USER_SYSTEMD="$HOME/.config/systemd/user"
    mkdir -p "$USER_SYSTEMD"
    NODE_BIN="$(command -v node)"
    NPX_BIN="$(command -v npx || true)"
    CODEX_BIN="$(command -v codex || true)"

    if [ "$NO_FARFIELD" -eq 0 ]; then
      cat > "$USER_SYSTEMD/codexhub-farfield.service" <<EOF_SERVICE
[Unit]
Description=CodexHub Farfield local server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$HOME
Environment=PORT=4311
Environment=CODEX_CLI_PATH=$CODEX_BIN
ExecStart=$NPX_BIN -y @farfield/server@latest
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF_SERVICE
    fi

    cat > "$USER_SYSTEMD/codexhub-agent.service" <<EOF_SERVICE
[Unit]
Description=CodexHub desktop agent
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/src/desktop-agent/agent.mjs --config $CONFIG_PATH
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF_SERVICE

    systemctl --user daemon-reload
    [ "$NO_FARFIELD" -eq 1 ] || systemctl --user enable --now codexhub-farfield.service
    systemctl --user enable --now codexhub-agent.service
  fi
fi

echo "CodexHub Linux agent installed."
echo "Config: $CONFIG_PATH"
echo "Node: $NODE_ID"
echo "Server: $SERVER"
echo "If services stop after logout, run: sudo loginctl enable-linger $USER"

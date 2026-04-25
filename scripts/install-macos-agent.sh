#!/usr/bin/env bash
set -euo pipefail

SERVER=""
INSTALL_KEY=""
NODE_ID="$(scutil --get ComputerName 2>/dev/null || hostname)"
NODE_NAME="$NODE_ID"
FARFIELD_URL="http://127.0.0.1:4311"
INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-$HOME/Library/Application Support/CodexHub}"
CONFIG_DIR="${CODEXHUB_CONFIG_DIR:-$HOME/Library/Application Support/CodexHub}"
LOG_DIR="$HOME/Library/Logs/CodexHub"
NO_LAUNCHD=0
NO_FARFIELD=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --install-key) INSTALL_KEY="$2"; shift 2 ;;
    --node-id) NODE_ID="$2"; shift 2 ;;
    --node-name) NODE_NAME="$2"; shift 2 ;;
    --farfield-url) FARFIELD_URL="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; CONFIG_DIR="$2"; shift 2 ;;
    --no-launchd) NO_LAUNCHD=1; shift ;;
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

mkdir -p "$INSTALL_DIR/src/desktop-agent" "$CONFIG_DIR" "$LOG_DIR"
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

if [ "$NO_LAUNCHD" -eq 0 ]; then
  LAUNCH_DIR="$HOME/Library/LaunchAgents"
  mkdir -p "$LAUNCH_DIR"
  NODE_BIN="$(command -v node)"
  CODEX_BIN="$(command -v codex || true)"

  if [ "$NO_FARFIELD" -eq 0 ]; then
    cat > "$LAUNCH_DIR/com.codexhub.farfield.plist" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.codexhub.farfield</string>
  <key>ProgramArguments</key><array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>export PORT=4311 CODEX_CLI_PATH="$CODEX_BIN"; cd "$HOME"; npx -y @farfield/server@latest</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/farfield.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/farfield.err.log</string>
</dict></plist>
EOF_PLIST
    launchctl unload "$LAUNCH_DIR/com.codexhub.farfield.plist" >/dev/null 2>&1 || true
    launchctl load "$LAUNCH_DIR/com.codexhub.farfield.plist"
  fi

  cat > "$LAUNCH_DIR/com.codexhub.agent.plist" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.codexhub.agent</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN</string>
    <string>$INSTALL_DIR/src/desktop-agent/agent.mjs</string>
    <string>--config</string>
    <string>$CONFIG_PATH</string>
  </array>
  <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/agent.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/agent.err.log</string>
</dict></plist>
EOF_PLIST
  launchctl unload "$LAUNCH_DIR/com.codexhub.agent.plist" >/dev/null 2>&1 || true
  launchctl load "$LAUNCH_DIR/com.codexhub.agent.plist"
fi

echo "CodexHub macOS agent installed."
echo "Config: $CONFIG_PATH"
echo "Node: $NODE_ID"
echo "Server: $SERVER"

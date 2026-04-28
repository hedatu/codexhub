#!/usr/bin/env bash
set -euo pipefail

SERVER=""
INSTALL_KEY=""
NODE_ID="$(scutil --get ComputerName 2>/dev/null || hostname)"
NODE_NAME="$NODE_ID"
FARFIELD_URL="http://127.0.0.1:4311"
FARFIELD_VERSION="${CODEXHUB_FARFIELD_VERSION:-0.2.2}"
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_SOURCE="$REPO_ROOT/src/desktop-agent/agent.mjs"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) GO_ARCH="amd64" ;;
  aarch64|arm64) GO_ARCH="arm64" ;;
  *) GO_ARCH="" ;;
esac

mkdir -p "$INSTALL_DIR/src/desktop-agent" "$INSTALL_DIR/bin" "$CONFIG_DIR" "$LOG_DIR"
if [ -d "$REPO_ROOT/node-runtime" ]; then
  rm -rf "$INSTALL_DIR/node-runtime"
  cp -R "$REPO_ROOT/node-runtime" "$INSTALL_DIR/node-runtime"
fi
cat > "$INSTALL_DIR/install-preflight.json" <<EOF_PREFLIGHT
{
  "os": "macos",
  "user": "$USER",
  "node": "$(command -v node || true)",
  "npx": "$(command -v npx || true)",
  "codex": "$(command -v codex || true)",
  "launchctl": "$(command -v launchctl || true)",
  "checkedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF_PREFLIGHT
AGENT_BIN=""
if [ -n "$GO_ARCH" ] && [ -f "$REPO_ROOT/bin/codexhub-agent-darwin-$GO_ARCH" ]; then
  AGENT_BIN="$INSTALL_DIR/bin/codexhub-agent"
  cp "$REPO_ROOT/bin/codexhub-agent-darwin-$GO_ARCH" "$AGENT_BIN"
  chmod +x "$AGENT_BIN"
else
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 20+ is required when the Go agent binary is not packaged." >&2
    exit 1
  fi
  cp "$AGENT_SOURCE" "$INSTALL_DIR/src/desktop-agent/agent.mjs"
fi

FARFIELD_BIN=""
if [ "$NO_FARFIELD" -eq 0 ]; then
  RUNTIME_DIR="$INSTALL_DIR/farfield-runtime"
  if [ -d "$REPO_ROOT/farfield-runtime" ]; then
    rm -rf "$RUNTIME_DIR"
    cp -R "$REPO_ROOT/farfield-runtime" "$RUNTIME_DIR"
  elif [ ! -f "$RUNTIME_DIR/node_modules/@farfield/server/dist/cli.js" ]; then
    if ! command -v npm >/dev/null 2>&1; then
      echo "Bundled Farfield runtime was not found and npm is unavailable." >&2
      exit 1
    fi
    mkdir -p "$RUNTIME_DIR"
    npm install --prefix "$RUNTIME_DIR" "@farfield/server@$FARFIELD_VERSION" --omit=dev --no-audit --no-fund
  fi
  if [ ! -f "$RUNTIME_DIR/node_modules/@farfield/server/dist/cli.js" ]; then
    echo "Farfield runtime is missing: $RUNTIME_DIR/node_modules/@farfield/server/dist/cli.js" >&2
    exit 1
  fi
  if [ -n "$GO_ARCH" ] && [ -f "$REPO_ROOT/bin/codexhub-farfield-darwin-$GO_ARCH" ]; then
    FARFIELD_BIN="$INSTALL_DIR/bin/codexhub-farfield"
    cp "$REPO_ROOT/bin/codexhub-farfield-darwin-$GO_ARCH" "$FARFIELD_BIN"
    chmod +x "$FARFIELD_BIN"
  elif ! command -v node >/dev/null 2>&1; then
    echo "Node.js 20+ is required when the Go Farfield launcher is not packaged." >&2
    exit 1
  fi
fi

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
  CODEX_BIN="$(command -v codex || echo codex)"
  if [ -n "$AGENT_BIN" ]; then
    AGENT_PROGRAM="$AGENT_BIN"
    AGENT_ARGS=""
  else
    NODE_BIN="$(command -v node)"
    AGENT_PROGRAM="$NODE_BIN"
    AGENT_ARGS="<string>$INSTALL_DIR/src/desktop-agent/agent.mjs</string>"
  fi

  if [ "$NO_FARFIELD" -eq 0 ]; then
    if [ -n "$FARFIELD_BIN" ]; then
      FARFIELD_PROGRAM="$FARFIELD_BIN"
      FARFIELD_ARGS="<string>--runtime</string>
    <string>$RUNTIME_DIR</string>
    <string>--codex-cli</string>
    <string>$CODEX_BIN</string>
    <string>--port</string>
    <string>4311</string>
    <string>--cwd</string>
    <string>$HOME</string>
    <string>--log-dir</string>
    <string>$LOG_DIR</string>"
    else
      FARFIELD_PROGRAM="$(command -v node)"
      FARFIELD_ARGS="<string>$RUNTIME_DIR/node_modules/@farfield/server/dist/cli.js</string>"
    fi
    cat > "$LAUNCH_DIR/com.codexhub.farfield.plist" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.codexhub.farfield</string>
  <key>ProgramArguments</key><array>
    <string>$FARFIELD_PROGRAM</string>
    $FARFIELD_ARGS
  </array>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>4311</string>
    <key>CODEX_CLI_PATH</key><string>$CODEX_BIN</string>
  </dict>
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
    <string>$AGENT_PROGRAM</string>
    $AGENT_ARGS
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

#!/usr/bin/env bash
set -euo pipefail

SERVER=""
INSTALL_KEY=""
NODE_ID="$(hostname)"
NODE_NAME="$NODE_ID"
FARFIELD_URL="http://127.0.0.1:4311"
FARFIELD_VERSION="${CODEXHUB_FARFIELD_VERSION:-0.2.2}"
INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-$HOME/.local/share/codexhub}"
CONFIG_DIR="${CODEXHUB_CONFIG_DIR:-$HOME/.config/codexhub}"
LOG_DIR="${CODEXHUB_LOG_DIR:-$INSTALL_DIR/logs}"
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

if [ "$NO_FARFIELD" -eq 0 ] && ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required to run bundled Farfield." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_SOURCE="$REPO_ROOT/src/desktop-agent/agent.mjs"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) GO_ARCH="amd64" ;;
  aarch64|arm64) GO_ARCH="arm64" ;;
  i386|i686) GO_ARCH="386" ;;
  *) GO_ARCH="" ;;
esac

mkdir -p "$INSTALL_DIR/src/desktop-agent" "$INSTALL_DIR/bin" "$CONFIG_DIR" "$LOG_DIR"
cat > "$INSTALL_DIR/install-preflight.json" <<EOF_PREFLIGHT
{
  "os": "linux",
  "user": "$USER",
  "node": "$(command -v node || true)",
  "npx": "$(command -v npx || true)",
  "codex": "$(command -v codex || true)",
  "systemctl": "$(command -v systemctl || true)",
  "checkedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF_PREFLIGHT
AGENT_BIN=""
if [ -n "$GO_ARCH" ] && [ -f "$REPO_ROOT/bin/codexhub-agent-linux-$GO_ARCH" ]; then
  AGENT_BIN="$INSTALL_DIR/bin/codexhub-agent"
  cp "$REPO_ROOT/bin/codexhub-agent-linux-$GO_ARCH" "$AGENT_BIN"
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
  if [ -n "$GO_ARCH" ] && [ -f "$REPO_ROOT/bin/codexhub-farfield-linux-$GO_ARCH" ]; then
    FARFIELD_BIN="$INSTALL_DIR/bin/codexhub-farfield"
    cp "$REPO_ROOT/bin/codexhub-farfield-linux-$GO_ARCH" "$FARFIELD_BIN"
    chmod +x "$FARFIELD_BIN"
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

if [ "$NO_SYSTEMD" -eq 0 ]; then
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found; installed files only." >&2
  else
    USER_SYSTEMD="$HOME/.config/systemd/user"
    mkdir -p "$USER_SYSTEMD"
    CODEX_BIN="$(command -v codex || echo codex)"

    if [ "$NO_FARFIELD" -eq 0 ]; then
      if [ -n "$FARFIELD_BIN" ]; then
        FARFIELD_EXEC="$FARFIELD_BIN --runtime $RUNTIME_DIR --codex-cli $CODEX_BIN --port 4311 --cwd $HOME --log-dir $LOG_DIR"
      else
        NODE_BIN="$(command -v node)"
        FARFIELD_EXEC="$NODE_BIN $RUNTIME_DIR/node_modules/@farfield/server/dist/cli.js"
      fi
      cat > "$USER_SYSTEMD/codexhub-farfield.service" <<EOF_SERVICE
[Unit]
Description=CodexHub Farfield local server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$HOME
Environment=PORT=4311
Environment=CODEX_CLI_PATH=$CODEX_BIN
ExecStart=$FARFIELD_EXEC
Restart=always
RestartSec=3
StandardOutput=append:$LOG_DIR/farfield.out.log
StandardError=append:$LOG_DIR/farfield.err.log

[Install]
WantedBy=default.target
EOF_SERVICE
    fi

    if [ -n "$AGENT_BIN" ]; then
      AGENT_EXEC="$AGENT_BIN --config $CONFIG_PATH"
    else
      NODE_BIN="$(command -v node)"
      AGENT_EXEC="$NODE_BIN $INSTALL_DIR/src/desktop-agent/agent.mjs --config $CONFIG_PATH"
    fi

    cat > "$USER_SYSTEMD/codexhub-agent.service" <<EOF_SERVICE
[Unit]
Description=CodexHub desktop agent
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$AGENT_EXEC
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

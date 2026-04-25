#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-$HOME/Library/Application Support/CodexHub}"
CONFIG_DIR="${CODEXHUB_CONFIG_DIR:-$HOME/Library/Application Support/CodexHub}"
LOG_DIR="$HOME/Library/Logs/CodexHub"
LAUNCH_DIR="$HOME/Library/LaunchAgents"

for plist in com.codexhub.agent.plist com.codexhub.farfield.plist; do
  launchctl unload "$LAUNCH_DIR/$plist" >/dev/null 2>&1 || true
  rm -f "$LAUNCH_DIR/$plist"
done

rm -rf "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR"
echo "CodexHub macOS agent uninstalled."

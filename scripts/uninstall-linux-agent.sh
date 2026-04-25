#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CODEXHUB_INSTALL_DIR:-$HOME/.local/share/codexhub}"
CONFIG_DIR="${CODEXHUB_CONFIG_DIR:-$HOME/.config/codexhub}"
USER_SYSTEMD="$HOME/.config/systemd/user"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now codexhub-agent.service >/dev/null 2>&1 || true
  systemctl --user disable --now codexhub-farfield.service >/dev/null 2>&1 || true
fi

rm -f "$USER_SYSTEMD/codexhub-agent.service" "$USER_SYSTEMD/codexhub-farfield.service"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

rm -rf "$INSTALL_DIR" "$CONFIG_DIR"
echo "CodexHub Linux agent uninstalled."

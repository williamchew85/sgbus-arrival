#!/usr/bin/env bash
# install-service.sh — install + enable the systemd backend service. Run with sudo.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
UNIT_SRC="$APP_DIR/scripts/sgbus-arrival.service"
UNIT_DST="/etc/systemd/system/sgbus-arrival.service"

echo "[install-service] App:  $APP_DIR"
echo "[install-service] User: $RUN_USER"

NODE_BIN="$(command -v node)"
sed \
  -e "s|__USER__|$RUN_USER|g" \
  -e "s|__APP_DIR__|$APP_DIR|g" \
  -e "s|/usr/bin/node|$NODE_BIN|g" \
  "$UNIT_SRC" | sudo tee "$UNIT_DST" >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable sgbus-arrival.service
sudo systemctl restart sgbus-arrival.service

echo "[install-service] Installed and started. Check with:"
echo "  systemctl status sgbus-arrival.service"
echo "  curl -s http://127.0.0.1:3000/healthz"

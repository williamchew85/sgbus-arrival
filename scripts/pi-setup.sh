#!/usr/bin/env bash
# pi-setup.sh — one-time setup of the SG Bus display on a Raspberry Pi (Pi OS Bookworm+).
# Installs Node LTS, project deps, and prepares the .env. Idempotent-ish: safe to re-run.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "[pi-setup] App directory: $APP_DIR"

# --- 1. Node LTS -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')" -lt 22 ]; then
  echo "[pi-setup] Installing Node.js LTS (>=22)…"
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[pi-setup] Node $(node --version) already present."
fi

# --- 2. Chromium (kiosk) + helpers ----------------------------------------
echo "[pi-setup] Installing Chromium + unclutter…"
sudo apt-get update
sudo apt-get install -y chromium-browser unclutter || sudo apt-get install -y chromium unclutter

# --- 3. Project deps -------------------------------------------------------
cd "$APP_DIR"
echo "[pi-setup] Installing npm deps…"
npm ci || npm install

# --- 4. .env ---------------------------------------------------------------
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "[pi-setup] Created .env from .env.example."
  echo "[pi-setup] >>> Edit $APP_DIR/.env and set LTA_ACCOUNT_KEY before starting. <<<"
else
  echo "[pi-setup] .env already exists — leaving it untouched."
fi

echo "[pi-setup] Done. Next:"
echo "  1. Edit .env (LTA_ACCOUNT_KEY, HOST, stops)."
echo "  2. Edit config/stops.json for your bus stops."
echo "  3. Install the service:  sudo bash scripts/install-service.sh"
echo "  4. Set up the kiosk autostart: see scripts/kiosk-start.sh and README."

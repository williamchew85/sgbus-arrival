#!/usr/bin/env bash
# install-autostart.sh — make the Chromium kiosk launch on desktop login.
# Handles both Pi OS Bookworm (labwc/wayfire) and older LXDE/X11 sessions.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH="$APP_DIR/scripts/kiosk-start.sh"
chmod +x "$LAUNCH"

USER_HOME="${HOME}"
echo "[autostart] Launcher: $LAUNCH"

# --- labwc (Pi OS Bookworm default on Pi 4/5) ------------------------------
LABWC_DIR="$USER_HOME/.config/labwc"
if [ -d "$USER_HOME/.config" ]; then
  mkdir -p "$LABWC_DIR"
  AUTOSTART="$LABWC_DIR/autostart"
  if ! grep -qF "$LAUNCH" "$AUTOSTART" 2>/dev/null; then
    echo "$LAUNCH &" >> "$AUTOSTART"
    echo "[autostart] Added to labwc autostart: $AUTOSTART"
  fi
fi

# --- wayfire (older Bookworm) ---------------------------------------------
WAYFIRE_INI="$USER_HOME/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ] && ! grep -qF "kiosk-start.sh" "$WAYFIRE_INI"; then
  {
    echo ""
    echo "[autostart]"
    echo "sgbus = $LAUNCH"
  } >> "$WAYFIRE_INI"
  echo "[autostart] Added to wayfire.ini"
fi

# --- LXDE / X11 (Pi OS Bullseye and earlier) ------------------------------
LXDE_DIR="$USER_HOME/.config/lxsession/LXDE-pi"
if [ -d "$USER_HOME/.config/lxsession" ] || [ ! -d "$USER_HOME/.config/labwc" ]; then
  mkdir -p "$LXDE_DIR"
  LXAUTO="$LXDE_DIR/autostart"
  if ! grep -qF "$LAUNCH" "$LXAUTO" 2>/dev/null; then
    echo "@$LAUNCH" >> "$LXAUTO"
    echo "[autostart] Added to LXDE autostart: $LXAUTO"
  fi
fi

echo "[autostart] Done. Reboot to launch the kiosk, or run $LAUNCH now."

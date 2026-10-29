#!/usr/bin/env bash
# kiosk-start.sh — wait for the backend, then launch Chromium in kiosk mode.
# Autostarted on the Pi desktop session (see install-autostart.sh).
set -euo pipefail

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"
HEALTH="${URL}/healthz"

# Pick whichever Chromium binary this Pi OS ships.
CHROME="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$CHROME" ]; then
  echo "[kiosk] No chromium binary found. Install chromium-browser." >&2
  exit 1
fi

# Wait (up to ~60s) for the backend to report healthy.
echo "[kiosk] Waiting for backend at $HEALTH …"
for _ in $(seq 1 60); do
  if curl -fs "$HEALTH" >/dev/null 2>&1; then
    echo "[kiosk] Backend healthy."
    break
  fi
  sleep 1
done

# Disable screen blanking / DPMS and hide the cursor.
command -v xset >/dev/null 2>&1 && { xset s off; xset -dpms; xset s noblank; } || true
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.1 -root &

# Launch Chromium kiosk. Flags kill the crash/restore bubble and translate prompt.
exec "$CHROME" \
  --kiosk \
  --app="$URL" \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --incognito

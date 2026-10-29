# SG Bus Arrival → Raspberry Pi Custom Display

Live Singapore bus arrival times on a custom screen driven by a Raspberry Pi, sourced
from the [LTA DataMall](https://datamall.lta.gov.sg/) real-time bus-arrival feed.

The Pi hosts the backend **and** renders the display locally in a Chromium kiosk — no
cloud, no Google Cast, no public endpoint. The LTA account key stays server-side and
never reaches the browser.

## Features

- Typed LTA `BusArrivalv2` client with timeout + typed error results (never throws to
  the display).
- A poller that refreshes on an interval, caches the last-known good data per stop, flags
  **stale** on failure (never blanks the screen), and backs off on repeated errors.
- One Node process serves both the `/api` JSON and the static display (same-origin
  `localhost`, no CORS, no second service).
- A responsive dark kiosk display (800×480 DSI → 1920×1080 HDMI): per-service next 1–3
  arrivals in minutes, load colour (green/amber/red), double-deck + wheelchair icons,
  a multi-stop carousel, a clock, an "updated Xs ago" line, and a stale banner.
- systemd service (restart=always) + Chromium kiosk autostart for an unattended 24/7
  display that recovers from reboots and crashes.

## Requirements

- Node.js **22+** (uses native TypeScript stripping — no build step).
- An LTA DataMall account key.
- A Raspberry Pi (Pi 4/5 recommended) running Pi OS, with an HDMI monitor or the
  official 7" DSI touchscreen.

## Bill of materials (example)

- Raspberry Pi 4/5, power supply, microSD card (16 GB+).
- A display: any HDMI monitor, or the official Raspberry Pi 7" touchscreen (800×480).
- Network: Wi-Fi or Ethernet.

## Quick start (dev, any machine)

```sh
cp .env.example .env     # paste your LTA_ACCOUNT_KEY
npm install
npm test                 # unit + integration tests
npm run typecheck        # strict type-check
npm run dev              # run the backend with --watch, then open http://localhost:3000
```

## Configuration

Environment (see `.env.example`):

| Var | Default | Meaning |
| --- | --- | --- |
| `LTA_ACCOUNT_KEY` | *(required)* | DataMall key — server-side only. |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to also view from a phone on your LAN. |
| `POLL_INTERVAL_SECONDS` | `25` (min 10) | How often to refresh LTA data. |
| `STOPS_CONFIG` | `./config/stops.json` | Which stops/services to show. |

Stops (`config/stops.json`):

```json
{
  "stops": [
    { "busStopCode": "83139", "name": "Opp Tampines Stn", "services": [] },
    { "busStopCode": "01012", "name": "Hotel Grand Pacific", "services": ["175", "167"] }
  ]
}
```

`busStopCode` is the 5-digit LTA code. Leave `services` empty to show every service at the
stop, or list service numbers to filter. Change stops any time and
`sudo systemctl restart sgbus-arrival` — no rebuild.

## Raspberry Pi deployment

On the Pi, from the cloned repo directory:

```sh
# 1. Install Node, Chromium, deps, and create .env
bash scripts/pi-setup.sh
nano .env                 # set LTA_ACCOUNT_KEY
nano config/stops.json    # set your stops

# 2. Run the backend as a systemd service (restart=always, starts on boot)
sudo bash scripts/install-service.sh
curl -s http://127.0.0.1:3000/healthz   # should return {"ok":true,...}

# 3. Autostart the Chromium kiosk on desktop login
bash scripts/install-autostart.sh
sudo reboot
```

After reboot the Pi boots to the desktop, the backend comes up under systemd, and the
kiosk launcher waits for `/healthz` before opening Chromium full-screen on the display.

### How it stays up

- **Backend**: `sgbus-arrival.service` with `Restart=always` and
  `After=network-online.target`.
- **Kiosk**: launched from the desktop autostart; Chromium flags suppress the crash/restore
  bubble. To auto-relaunch Chromium if it is killed, wrap the launcher in a `while true`
  loop or a user systemd service (see `scripts/kiosk-start.sh`).
- **Data outage**: the poller keeps the last-known times on screen and shows the amber
  "showing last-known times" banner; it backs off and recovers automatically.

## Rate safety

Calls/day ≈ `(86400 / POLL_INTERVAL_SECONDS) × number_of_stops`. At the default 25s and
2 stops that is ~6,900 calls/day — far under LTA's 10M/day threshold. The display polls
the **local** backend every 15s; it never calls LTA directly, so adding display refreshes
or viewers costs nothing against the LTA quota.

## API

- `GET /api/arrivals` — all configured stops, from cache.
- `GET /api/arrivals/:busStopCode` — one stop (404 if not configured).
- `GET /healthz` — `{ ok, lastUpdated, anyStale, stops: [{code, stale}] }`.

No response contains the LTA key (verified in tests).

## Project layout

```
src/
  config.ts            env + stops validation (fail-fast)
  lta/
    types.ts           raw LTA + display model types
    transform.ts       pure ISO→minutes / load / type / sort (unit-tested)
    client.ts          typed BusArrivalv2 client (timeout, typed errors)
  poller/poller.ts     interval poll, cache, stale flag, backoff
  server/server.ts     /api + /healthz + static display, path-traversal guarded
  index.ts             wires it together, graceful shutdown
public/
  index.html styles.css app.js render.js   the kiosk display
config/stops.json      your stops
scripts/               pi-setup, systemd unit + installer, kiosk launcher + autostart
test/                  node:test suites + fixtures
```

## Troubleshooting

- **Blank / black screen**: check `systemctl status sgbus-arrival` and
  `journalctl -u sgbus-arrival -e`; confirm `curl http://127.0.0.1:3000/healthz` is OK.
- **Amber stale banner**: LTA or the network is down; the display keeps the last times. Check
  the Pi's internet and the `LTA_ACCOUNT_KEY`.
- **"LTA_ACCOUNT_KEY is not set"**: the service could not read `.env`; confirm the
  `EnvironmentFile` path in the unit and that `.env` has the key.
- **Kiosk did not launch**: run `scripts/kiosk-start.sh` manually to see errors; confirm the
  autostart file for your Pi OS session (labwc vs LXDE) was written.
- **Wrong stops**: edit `config/stops.json`, then `sudo systemctl restart sgbus-arrival`.

## Status

See [`todo.md`](./todo.md). Phases 0–6 implemented and tested on the dev host; the physical
on-Pi run (Phase 5.6 / 6.5) is pending access to the device.

## Windows dev note

Editing non-ASCII files (e.g. `todo.md`) with PowerShell `Set-Content` corrupts them (BOM +
mojibake). Use an editor that preserves UTF-8 without a BOM.

# SG Bus Arrival → Raspberry Pi Custom Display

**Goal:** Display live Singapore bus arrival times on a custom screen driven by a
Raspberry Pi, sourced from the LTA DataMall real-time bus-arrival feed. The Pi hosts
the backend *and* renders the display locally in a kiosk browser — no cloud, no Google
Cast, no public HTTPS.

**Stack (proposed):** Node.js + TypeScript backend (LTA proxy + poller) running on the
Pi, serving a static HTML5 display over `localhost`. The Pi boots into Chromium kiosk
mode pointed at that local page, shown on an attached HDMI monitor / official 7" DSI
touchscreen (see D1).

**Non-goals:** No native mobile app. No account/multi-user system (single-household,
single config). No cloud hosting or public endpoint (the Pi is the whole system). No
Google Cast / Nest surface. No control of the bus — read-only display.

**Auto-selected: no** — project chosen by the user (LTA DataMall + Raspberry Pi custom
display).

---

## Decisions to make (blockers)

> Resolve these before the phase that depends on them. Each is a genuine
> cost/architecture fork, not a coding detail.

- **D1 — Pi model + display surface.** Drives Phase 4 layout dimensions and Phase 5 boot
  setup. Options:
  - **(A) Pi 4/5 + HDMI monitor** *(default)* — any size; display built for 1280×720 or
    1920×1080 landscape, scaled to fit. Most flexible, cheapest if a monitor exists.
  - **(B) Pi + official 7" DSI touchscreen (800×480)** — compact desk/wall unit; layout
    must target 800×480 and stay glanceable at that density. Touch unused (read-only) but
    available.
  - **(C) Pi Zero 2 W + small SPI/HDMI panel** — lowest power/cost, but Chromium kiosk is
    sluggish on Zero-class hardware; only if ultra-low-power matters.
  - *Default if unanswered:* **(A)**, with the Phase-4 CSS written responsively so (B) is a
    viewport/config change, not a rewrite.

- **D2 — How the kiosk launches on boot.** Options:
  - **(A) Chromium `--kiosk` via a systemd user service / autostart** *(default)* — boots to
    desktop (or wayland/labwc on Pi OS Bookworm), auto-launches full-screen Chromium at the
    local URL, auto-restarts if it crashes. Standard, robust.
  - **(B) Dedicated kiosk image (e.g. FullPageOS)** — flash-and-go, but another moving part
    and harder to version the app inside it.
  - *Default if unanswered:* **(A)** — a documented systemd/autostart entry + a launch
    script, so the whole setup lives in this repo.

- **D3 — Backend ↔ display coupling on one box.** Since the Pi is both server and client,
  the display talks to `http://localhost:<port>`; the LTA key stays in the backend process
  env and never reaches the browser page. *Default (no user choice needed, recorded so it
  is not violated):* one Node process serves both the static display assets **and** the
  `/api` JSON; display fetches same-origin `localhost`. LTA key in `.env` on the Pi only.

- **D4 — Which stop(s)/service(s) to show.** One bus stop with all services, or a fixed
  short list of (stop, service) pairs for a commute. *Default:* config file listing 1–3
  `BusStopCode` entries (+ optional service filter), editable on the Pi without a rebuild.

- **D5 — Dev vs. Pi target during build.** The build + unit work happens on this Windows
  host; only Phase 5 (kiosk boot) needs the physical Pi. *Default:* Phases 0–4 are developed
  and tested cross-platform here (Node runs identically); Phase 5 ships Pi-specific scripts
  the user runs on the device, with a photo/console check back from the Pi.

---

## Phase 0 — Project scaffold & config

- [x] 0.1 Init Node + TypeScript project (`package.json`, `tsconfig.json`, strict mode).
- [x] 0.2 `.gitignore` (node_modules, dist, `.env`), `.env.example` with `LTA_ACCOUNT_KEY=`.
- [x] 0.3 Config module: load `LTA_ACCOUNT_KEY` + stop/service list (D4) from env/JSON;
      fail fast with a clear message if the key is missing.
- [x] 0.4 Minimal test runner wired (`node --test` or vitest); one trivial passing test.
- [x] 0.5 README stub: what it does, prerequisites, the D1/D2 decision placeholders.

## Phase 1 — LTA DataMall client (core, engine-testable)

- [x] 1.1 Typed `BusArrivalv2` client: `GET http://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=<code>[&ServiceNo=<svc>]`, header `AccountKey: <key>`, `Accept: application/json`.
- [x] 1.2 Response model types: `Services[]` → `NextBus / NextBus2 / NextBus3` with
      `EstimatedArrival`, `Load` (SEA/SDA/LSD), `Type` (SD/DD/BD), `Feature` (wheelchair).
- [x] 1.3 Pure transform: raw ISO `EstimatedArrival` → minutes-until-arrival (clamp to
      "Arr" when <=0, "No bus" when field empty). This is the unit under test.
- [x] 1.4 Error handling: non-200, empty `Services`, malformed time, network timeout →
      typed results, never throws to the display.
- [x] 1.5 **Tests:** snapshot the transform against recorded sample payloads (arriving,
      several-min-away, no-service, wheelchair, DD/single-deck, each Load level). No live
      network in tests — fixtures only.

## Phase 2 — Poller & cache layer

- [x] 2.1 Poller that refreshes configured stops on an interval (default 20–30s; respects
      LTA threshold, never per-render fetch).
- [x] 2.2 In-memory cache of the latest transformed result per stop + `lastUpdated` + a
      `stale` flag when the last fetch failed.
- [x] 2.3 Backoff on repeated LTA failures; surface stale-but-last-known rather than blanking.
- [x] 2.4 **Tests:** poller serves cached value between ticks; marks stale on failure;
      recovers on next success (fake timers + stubbed client).

## Phase 3 — Backend HTTP API + static server (runs on the Pi)

- [x] 3.1 `GET /api/arrivals` → JSON for all configured stops from cache (keeps D3: LTA key
      never leaves the server process).
- [x] 3.2 `GET /api/arrivals/:stopCode` → single stop.
- [x] 3.3 `GET /healthz` → ok + lastUpdated + stale flags (for a boot-readiness check).
- [x] 3.4 Same one process also serves the Phase-4 static display assets, so the browser
      fetches same-origin from `localhost` (no CORS, no second service).
- [x] 3.5 Bind to `127.0.0.1` only (or `0.0.0.0` behind the Pi's LAN only if the user wants
      to view it from a phone too — default localhost-only).
- [x] 3.6 **Tests:** endpoint returns shaped JSON from a seeded cache; `:stopCode` 404s an
      unknown stop; healthz reflects stale state; static route serves the display HTML.

## Phase 4 — Web display (Pi-kiosk-shaped HTML5)

- [x] 4.1 Single static page: large-type, high-contrast, landscape, responsive from 800×480
      (DSI screen, D1=B) up to 1920×1080 (HDMI, D1=A); no scrolling, glanceable.
- [x] 4.2 Render per stop: stop name, each service's next 1–3 arrivals in minutes, load
      colour (green/amber/red), DD/wheelchair icons.
- [x] 4.3 Polls `GET /api/arrivals` every ~15s client-side; shows a subtle "updated Xs ago"
      and a stale banner when the backend flag is set.
- [x] 4.4 Auto-rotate between stops if more than one configured (timed carousel), reduced-
      motion respected.
- [x] 4.5 Dark theme by default (ambient display); readable at a glance from across a room;
      optional clock + current time for context.
- [x] 4.6 Hide the mouse cursor and disable text selection / overscroll (kiosk polish).
- [x] 4.7 Verify rendering headless (the browser tool refuses loopback here) by driving the
      exact `/api/arrivals` payload through the render logic in Node; ask the user for a
      screenshot from the actual Pi screen.

## Phase 5 — Raspberry Pi kiosk deployment *(implements D1/D2)*

> Build Phases 0–4 first — they are hardware-neutral and run on this dev host.

- [x] 5.1 `scripts/pi-setup.sh`: install Node LTS on Pi OS, clone/copy the app, `npm ci`,
      build, create `.env` from `.env.example` with the real `LTA_ACCOUNT_KEY`.
- [x] 5.2 systemd **service** unit (`sgbus-arrival.service`) that runs the Node backend on
      boot, restart=always, after network-online.target.
- [x] 5.3 Kiosk launcher (`scripts/kiosk-start.sh`): wait for `/healthz` ok, then launch
      Chromium `--kiosk --app=http://localhost:<port>` with flags to disable the crash
      bubble, translate prompt, screensaver/DPMS blanking, and swipe/overscroll.
- [x] 5.4 Autostart the kiosk launcher on desktop login (D2=A) — labwc/wayfire autostart on
      Bookworm, or `~/.config/autostart` / LXDE autostart on older Pi OS; document which.
- [x] 5.5 Disable screen blanking + hide cursor (`unclutter`) so the display stays on 24/7.
- [ ] 5.6 **(BLOCKED: needs physical Pi)** End-to-end on the device: power-on → backend up → Chromium kiosk shows live
      arrivals → values track the LTA feed → survives a backend stale window gracefully →
      recovers after a reboot. Capture a device photo from the user.

## Phase 6 — Hardening & docs

- [x] 6.1 Rate-safety: confirm poll interval × stop count stays far under LTA's threshold;
      log daily call count on the Pi.
- [x] 6.2 Config documented: how to change stops/services (D4) on the Pi (edit config +
      `systemctl restart sgbus-arrival`), no rebuild.
- [x] 6.3 Resilience: backend `restart=always`; kiosk auto-relaunch if Chromium dies;
      graceful stale banner when LTA or network is down; auto-recover on power loss.
- [x] 6.4 Full README: bill of materials (Pi model, screen, PSU, SD card), flashing Pi OS,
      `pi-setup.sh` steps, systemd + kiosk autostart, env vars, troubleshooting (blank
      screen, stale banner, key errors, Wi-Fi drop).
- [ ] 6.5 **(BLOCKED: needs physical Pi)** Final run-through on the real Pi; list anything blocked on physical device access.

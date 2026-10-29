// Browser glue for the SG Bus display. Pure rendering lives in render.js.
import { renderServices, updatedAgo } from '/render.js';

const POLL_MS = 15_000;
const ROTATE_MS = 8_000;

const els = {
  stopName: document.getElementById('stop-name'),
  services: document.getElementById('services'),
  updated: document.getElementById('updated'),
  clock: document.getElementById('clock'),
  staleBanner: document.getElementById('stale-banner'),
  dots: document.getElementById('dots'),
};

let stops = [];
let current = 0;
let anyStale = false;
let lastUpdated = null;

function renderCurrent() {
  if (stops.length === 0) {
    els.stopName.textContent = 'No stops configured';
    els.services.innerHTML = '';
    return;
  }
  const stop = stops[current % stops.length];
  els.stopName.textContent = stop.name;
  els.services.innerHTML = renderServices(stop);
  els.staleBanner.hidden = !(stop.stale || anyStale);
  renderDots();
}

function renderDots() {
  if (stops.length <= 1) {
    els.dots.hidden = true;
    return;
  }
  els.dots.hidden = false;
  els.dots.innerHTML = stops
    .map((_, i) => `<span class="dot ${i === current % stops.length ? 'active' : ''}"></span>`)
    .join('');
}

async function poll() {
  try {
    const res = await fetch('/api/arrivals', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json();
    stops = Array.isArray(body.stops) ? body.stops : [];
    anyStale = Boolean(body.anyStale);
    lastUpdated = body.lastUpdated ?? null;
  } catch {
    // Keep showing the last data; flag stale.
    anyStale = true;
  }
  renderCurrent();
}

function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  els.clock.textContent = `${hh}:${mm}`;
  els.updated.textContent = updatedAgo(lastUpdated, Date.now());
}

function rotate() {
  if (stops.length <= 1) return;
  current = (current + 1) % stops.length;
  renderCurrent();
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

void poll();
tickClock();
setInterval(poll, POLL_MS);
setInterval(tickClock, 1000);
if (!reduceMotion) setInterval(rotate, ROTATE_MS);

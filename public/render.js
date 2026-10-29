// Pure render helpers for the SG Bus display.
// No DOM, no globals — returns HTML strings so it can be unit-tested in Node
// (the loopback browser tool is unavailable on this host; see todo 4.7).

/** @typedef {{minutes:number|null,label:string,arriving:boolean,load:string,busType:string,wheelchair:boolean}} Arrival */
/** @typedef {{serviceNo:string,operator:string,arrivals:Arrival[]}} ServiceArrivals */
/** @typedef {{busStopCode:string,name:string,stale:boolean,lastUpdated:number|null,services:ServiceArrivals[]}} ApiStop */

/** Escape text for safe HTML interpolation. */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render one arrival cell. */
export function renderArrival(a) {
  const isNoBus = a.minutes === null;
  const cls = ['arrival', a.arriving ? 'arr' : '', isNoBus ? 'no-bus' : '']
    .filter(Boolean)
    .join(' ');

  if (isNoBus) {
    return `<div class="${cls}"><span class="mins">${esc(a.label)}</span></div>`;
  }

  const mins = a.arriving ? 'Arr' : String(a.minutes);
  const unit = a.arriving ? '' : '<span class="unit">min</span>';
  const loadClass = `load-${esc(a.load)}`;
  const wheelchair = a.wheelchair ? '<span class="icon" title="Wheelchair accessible">♿</span>' : '';
  const doubleDeck = a.busType === 'double' ? '<span class="icon" title="Double deck">⇅</span>' : '';

  return (
    `<div class="${cls}">` +
    `<span class="mins">${esc(mins)}</span>${unit}` +
    `<span class="badges"><span class="load-dot ${loadClass}"></span>${wheelchair}${doubleDeck}</span>` +
    `</div>`
  );
}

/** Render one service row. */
export function renderService(s) {
  const cells = s.arrivals.map(renderArrival).join('');
  return (
    `<div class="service">` +
    `<span class="service-no">${esc(s.serviceNo)}</span>` +
    `<div class="arrivals">${cells}</div>` +
    `</div>`
  );
}

/** Render the services block for a stop (inner HTML of #services). */
export function renderServices(stop) {
  if (!stop.services || stop.services.length === 0) {
    return `<div class="service"><span class="service-no">—</span><div class="arrivals"><div class="arrival no-bus"><span class="mins">No services</span></div></div></div>`;
  }
  return stop.services.map(renderService).join('');
}

/** Human "updated Xs ago" string from a lastUpdated epoch-ms and a now epoch-ms. */
export function updatedAgo(lastUpdated, now) {
  if (lastUpdated === null || lastUpdated === undefined) return 'no data yet';
  const secs = Math.max(0, Math.floor((now - lastUpdated) / 1000));
  if (secs < 60) return `updated ${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `updated ${mins}m ago`;
}

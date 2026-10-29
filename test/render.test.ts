import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  renderArrival,
  renderService,
  renderServices,
  updatedAgo,
} from '../public/render.js';

test('esc escapes HTML special chars', () => {
  assert.equal(esc('<b>&"x'), '&lt;b&gt;&amp;&quot;x');
});

test('renderArrival: minutes-away shows number + min unit + load dot', () => {
  const html = renderArrival({
    minutes: 7,
    label: '7 min',
    arriving: false,
    load: 'medium',
    busType: 'single',
    wheelchair: false,
  });
  assert.match(html, /class="mins">7</);
  assert.match(html, /class="unit">min</);
  assert.match(html, /load-medium/);
  assert.ok(!html.includes('no-bus'));
});

test('renderArrival: arriving shows Arr and the arr class', () => {
  const html = renderArrival({
    minutes: 0,
    label: 'Arr',
    arriving: true,
    load: 'low',
    busType: 'single',
    wheelchair: false,
  });
  assert.match(html, /class="arrival arr"/);
  assert.match(html, /class="mins">Arr</);
});

test('renderArrival: no bus', () => {
  const html = renderArrival({
    minutes: null,
    label: 'No bus',
    arriving: false,
    load: 'unknown',
    busType: 'unknown',
    wheelchair: false,
  });
  assert.match(html, /no-bus/);
  assert.match(html, /No bus/);
});

test('renderArrival: wheelchair + double-deck icons', () => {
  const html = renderArrival({
    minutes: 3,
    label: '3 min',
    arriving: false,
    load: 'high',
    busType: 'double',
    wheelchair: true,
  });
  assert.match(html, /♿/);
  assert.match(html, /⇅/);
  assert.match(html, /load-high/);
});

test('renderService emits service number and all arrival cells', () => {
  const html = renderService({
    serviceNo: '15',
    operator: 'GAS',
    arrivals: [
      { minutes: 0, label: 'Arr', arriving: true, load: 'low', busType: 'single', wheelchair: false },
      { minutes: 7, label: '7 min', arriving: false, load: 'medium', busType: 'double', wheelchair: false },
    ],
  });
  assert.match(html, /service-no">15</);
  const cells = html.match(/class="arrival[ "]/g) ?? [];
  assert.equal(cells.length, 2);
});

test('renderServices against the exact API payload shape', () => {
  // Mirror what GET /api/arrivals returns per stop.
  const apiStop = {
    busStopCode: '83139',
    name: 'Opp Tampines Stn',
    stale: false,
    lastUpdated: 1000,
    services: [
      {
        serviceNo: '2',
        operator: 'SBST',
        arrivals: [
          { minutes: 0, label: 'Arr', arriving: true, load: 'low', busType: 'single', wheelchair: false },
        ],
      },
      {
        serviceNo: '150',
        operator: 'SBST',
        arrivals: [
          { minutes: null, label: 'No bus', arriving: false, load: 'unknown', busType: 'unknown', wheelchair: false },
        ],
      },
    ],
  };
  const html = renderServices(apiStop);
  assert.match(html, /service-no">2</);
  assert.match(html, /service-no">150</);
  assert.match(html, /Arr/);
  assert.match(html, /No bus/);
});

test('renderServices: empty services shows placeholder', () => {
  const html = renderServices({ busStopCode: 'x', name: 'x', stale: false, lastUpdated: null, services: [] });
  assert.match(html, /No services/);
});

test('updatedAgo formats seconds and minutes', () => {
  assert.equal(updatedAgo(null, 10_000), 'no data yet');
  assert.equal(updatedAgo(10_000, 15_000), 'updated 5s ago');
  assert.equal(updatedAgo(0, 125_000), 'updated 2m ago');
});

test('renderService escapes injection in serviceNo', () => {
  const html = renderService({
    serviceNo: '<script>x</script>',
    operator: 'x',
    arrivals: [],
  });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

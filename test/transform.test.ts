import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  toArrival,
  toStopArrivals,
  loadLevel,
  busType,
} from '../src/lta/transform.ts';
import type { RawBusArrivalResponse, RawNextBus } from '../src/lta/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'busarrival-83139.json'), 'utf8'),
) as RawBusArrivalResponse;

// Fixed "now" so the fixture's absolute times map to deterministic minutes.
const NOW = new Date('2026-10-30T10:00:00+08:00');

function rawBus(partial: Partial<RawNextBus>): RawNextBus {
  return {
    OriginCode: '',
    DestinationCode: '',
    EstimatedArrival: '',
    Latitude: '0',
    Longitude: '0',
    VisitNumber: '0',
    Load: '',
    Feature: '',
    Type: '',
    ...partial,
  };
}

test('loadLevel maps all codes', () => {
  assert.equal(loadLevel('SEA'), 'low');
  assert.equal(loadLevel('SDA'), 'medium');
  assert.equal(loadLevel('LSD'), 'high');
  assert.equal(loadLevel(''), 'unknown');
  assert.equal(loadLevel('???'), 'unknown');
});

test('busType maps all codes', () => {
  assert.equal(busType('SD'), 'single');
  assert.equal(busType('DD'), 'double');
  assert.equal(busType('BD'), 'bendy');
  assert.equal(busType(''), 'unknown');
});

test('toArrival: several minutes away', () => {
  const a = toArrival(rawBus({ EstimatedArrival: '2026-10-30T10:07:00+08:00' }), NOW);
  assert.equal(a.minutes, 7);
  assert.equal(a.label, '7 min');
  assert.equal(a.arriving, false);
});

test('toArrival: arriving now (<=0) -> Arr', () => {
  // 30s away floors to 0 min -> "Arr".
  const a = toArrival(rawBus({ EstimatedArrival: '2026-10-30T10:00:30+08:00' }), NOW);
  assert.equal(a.minutes, 0);
  assert.equal(a.label, 'Arr');
  assert.equal(a.arriving, true);
});

test('toArrival: already past -> Arr with negative minutes', () => {
  const a = toArrival(rawBus({ EstimatedArrival: '2026-10-30T09:58:00+08:00' }), NOW);
  assert.ok(a.minutes !== null && a.minutes < 0);
  assert.equal(a.label, 'Arr');
  assert.equal(a.arriving, true);
});

test('toArrival: empty time -> No bus', () => {
  const a = toArrival(rawBus({ EstimatedArrival: '' }), NOW);
  assert.equal(a.minutes, null);
  assert.equal(a.label, 'No bus');
  assert.equal(a.arriving, false);
});

test('toArrival: malformed time -> No bus (never throws)', () => {
  const a = toArrival(rawBus({ EstimatedArrival: 'not-a-date' }), NOW);
  assert.equal(a.minutes, null);
  assert.equal(a.label, 'No bus');
});

test('toArrival: undefined bus -> No bus with unknown fields', () => {
  const a = toArrival(undefined, NOW);
  assert.equal(a.label, 'No bus');
  assert.equal(a.load, 'unknown');
  assert.equal(a.busType, 'unknown');
  assert.equal(a.wheelchair, false);
});

test('toArrival: wheelchair + load + type flags', () => {
  const a = toArrival(
    rawBus({ EstimatedArrival: '2026-10-30T10:03:00+08:00', Load: 'LSD', Type: 'DD', Feature: 'WAB' }),
    NOW,
  );
  assert.equal(a.load, 'high');
  assert.equal(a.busType, 'double');
  assert.equal(a.wheelchair, true);
});

test('toStopArrivals: transforms fixture, sorted by soonest arrival', () => {
  const stop = toStopArrivals(fixture, 'Opp Tampines Stn', NOW);
  assert.equal(stop.busStopCode, '83139');
  assert.equal(stop.name, 'Opp Tampines Stn');
  // service "2" arrives at 09:59:50 (Arr) -> sorts before "15" (0.5 min -> 0).
  const order = stop.services.map((s) => s.serviceNo);
  assert.deepEqual(order, ['2', '15', '150']);
});

test('toStopArrivals: no-service row kept as single No bus', () => {
  const stop = toStopArrivals(fixture, 'Opp Tampines Stn', NOW);
  const s150 = stop.services.find((s) => s.serviceNo === '150')!;
  assert.equal(s150.arrivals.length, 1);
  assert.equal(s150.arrivals[0]!.label, 'No bus');
});

test('toStopArrivals: trailing No-bus slot trimmed', () => {
  const stop = toStopArrivals(fixture, 'Opp Tampines Stn', NOW);
  const s2 = stop.services.find((s) => s.serviceNo === '2')!;
  // service "2" has 2 real + 1 empty -> trimmed to 2.
  assert.equal(s2.arrivals.length, 2);
});

test('toStopArrivals: service filter keeps only requested', () => {
  const stop = toStopArrivals(fixture, 'Opp Tampines Stn', NOW, ['15']);
  assert.equal(stop.services.length, 1);
  assert.equal(stop.services[0]!.serviceNo, '15');
  // Three real arrivals (SEA/SD/WAB, SDA/DD, LSD/BD/WAB).
  assert.equal(stop.services[0]!.arrivals.length, 3);
  assert.deepEqual(
    stop.services[0]!.arrivals.map((a) => a.label),
    ['Arr', '7 min', '15 min'],
  );
});

test('toStopArrivals: tolerates missing Services (never throws)', () => {
  const stop = toStopArrivals(
    { BusStopCode: '00000', Services: undefined as never },
    'Nowhere',
    NOW,
  );
  assert.deepEqual(stop.services, []);
});

test('toStopArrivals: deterministic (same input -> same output)', () => {
  const a = toStopArrivals(fixture, 'X', NOW);
  const b = toStopArrivals(fixture, 'X', NOW);
  assert.deepEqual(a, b);
});

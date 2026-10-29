import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStopsConfig, loadConfig, ConfigError } from '../src/config.ts';

test('parseStopsConfig accepts a valid config', () => {
  const stops = parseStopsConfig(
    JSON.stringify({
      stops: [{ busStopCode: '83139', name: 'Opp Tampines Stn', services: [] }],
    }),
  );
  assert.equal(stops.length, 1);
  assert.equal(stops[0]!.busStopCode, '83139');
  assert.deepEqual(stops[0]!.services, []);
});

test('parseStopsConfig defaults name to code and services to []', () => {
  const stops = parseStopsConfig(JSON.stringify({ stops: [{ busStopCode: '01012' }] }));
  assert.equal(stops[0]!.name, '01012');
  assert.deepEqual(stops[0]!.services, []);
});

test('parseStopsConfig rejects non-5-digit stop code', () => {
  assert.throws(
    () => parseStopsConfig(JSON.stringify({ stops: [{ busStopCode: '123' }] })),
    ConfigError,
  );
});

test('parseStopsConfig rejects empty stops array', () => {
  assert.throws(() => parseStopsConfig(JSON.stringify({ stops: [] })), ConfigError);
});

test('parseStopsConfig rejects invalid JSON', () => {
  assert.throws(() => parseStopsConfig('{ not json'), ConfigError);
});

test('loadConfig fails fast when LTA_ACCOUNT_KEY is missing', () => {
  assert.throws(() => loadConfig({}), /LTA_ACCOUNT_KEY is not set/);
});

test('loadConfig rejects too-small poll interval', () => {
  assert.throws(
    () =>
      loadConfig(
        { LTA_ACCOUNT_KEY: 'x', POLL_INTERVAL_SECONDS: '5', STOPS_CONFIG: './config/stops.json' },
        process.cwd(),
      ),
    /POLL_INTERVAL_SECONDS must be >= 10/,
  );
});

test('loadConfig loads defaults and the shipped stops config', () => {
  const cfg = loadConfig({ LTA_ACCOUNT_KEY: 'test-key' }, process.cwd());
  assert.equal(cfg.ltaAccountKey, 'test-key');
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.pollIntervalMs, 25_000);
  assert.ok(cfg.stops.length >= 1);
});

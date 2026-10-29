import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LtaClient } from '../src/lta/client.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureText = readFileSync(
  join(here, 'fixtures', 'busarrival-83139.json'),
  'utf8',
);
const NOW = () => new Date('2026-10-30T10:00:00+08:00');

function okFetch(body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

test('getArrivals: success path transforms and reports ok', async () => {
  const client = new LtaClient({
    accountKey: 'k',
    fetchFn: okFetch(fixtureText),
    now: NOW,
  });
  const r = await client.getArrivals('83139', 'Opp Tampines Stn');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.busStopCode, '83139');
    assert.equal(r.data.services[0]!.serviceNo, '2'); // soonest
  }
});

test('getArrivals: sends AccountKey header', async () => {
  let seenKey: string | null = null;
  const spyFetch = (async (_url: string, init: RequestInit) => {
    seenKey = (init.headers as Record<string, string>)['AccountKey'] ?? null;
    return new Response(fixtureText, { status: 200 });
  }) as unknown as typeof fetch;
  const client = new LtaClient({ accountKey: 'secret-key', fetchFn: spyFetch, now: NOW });
  await client.getArrivals('83139', 'X');
  assert.equal(seenKey, 'secret-key');
});

test('getArrivals: HTTP error -> kind http with status', async () => {
  const client = new LtaClient({
    accountKey: 'k',
    fetchFn: (async () => new Response('nope', { status: 429 })) as unknown as typeof fetch,
    now: NOW,
  });
  const r = await client.getArrivals('83139', 'X');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, 'http');
    assert.equal(r.status, 429);
  }
});

test('getArrivals: network throw -> kind network', async () => {
  const client = new LtaClient({
    accountKey: 'k',
    fetchFn: (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch,
    now: NOW,
  });
  const r = await client.getArrivals('83139', 'X');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'network');
});

test('getArrivals: abort -> kind timeout', async () => {
  const client = new LtaClient({
    accountKey: 'k',
    fetchFn: (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch,
    now: NOW,
  });
  const r = await client.getArrivals('83139', 'X');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'timeout');
});

test('getArrivals: bad JSON -> kind parse', async () => {
  const client = new LtaClient({
    accountKey: 'k',
    fetchFn: (async () => new Response('{ not json', { status: 200 })) as unknown as typeof fetch,
    now: NOW,
  });
  const r = await client.getArrivals('83139', 'X');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'parse');
});

test('getArrivals: unexpected shape -> kind parse', async () => {
  const client = new LtaClient({
    accountKey: 'k',
    fetchFn: okFetch(JSON.stringify({ wrong: true })),
    now: NOW,
  });
  const r = await client.getArrivals('83139', 'X');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, 'parse');
});

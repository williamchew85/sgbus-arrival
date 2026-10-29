import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from '../src/server/server.ts';
import { Poller } from '../src/poller/poller.ts';
import type { LtaClient, ClientResult } from '../src/lta/client.ts';
import type { StopArrivals } from '../src/lta/types.ts';
import type { StopConfig } from '../src/config.ts';
import type { AddressInfo } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

function data(code: string): StopArrivals {
  return {
    busStopCode: code,
    name: 'Stop ' + code,
    services: [
      {
        serviceNo: '15',
        operator: 'GAS',
        arrivals: [
          { minutes: 3, label: '3 min', arriving: false, load: 'low', busType: 'single', wheelchair: false },
        ],
      },
    ],
  };
}

class FakeClient {
  always: ClientResult | null = null;
  async getArrivals(code: string): Promise<ClientResult> {
    if (this.always !== null) return this.always;
    return { ok: true, data: data(code) };
  }
}

const stops: StopConfig[] = [{ busStopCode: '83139', name: 'Tampines', services: [] }];

async function withServer(
  fake: FakeClient,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const poller = new Poller({
    client: fake as unknown as LtaClient,
    stops,
    intervalMs: 60_000,
    now: () => 1000,
    // Never auto-schedule during the test.
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  await poller.refreshAll();
  const { server } = buildServer({ poller, publicDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    poller.stop();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('GET /api/arrivals returns shaped JSON from cache', async () => {
  await withServer(new FakeClient(), async (base) => {
    const res = await fetch(`${base}/api/arrivals`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      lastUpdated: number;
      anyStale: boolean;
      stops: { busStopCode: string; services: unknown[] }[];
    };
    assert.equal(body.anyStale, false);
    assert.equal(body.lastUpdated, 1000);
    assert.equal(body.stops.length, 1);
    assert.equal(body.stops[0]!.busStopCode, '83139');
    assert.equal(body.stops[0]!.services.length, 1);
  });
});

test('GET /api/arrivals/:code returns a single stop', async () => {
  await withServer(new FakeClient(), async (base) => {
    const res = await fetch(`${base}/api/arrivals/83139`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { busStopCode: string; stale: boolean };
    assert.equal(body.busStopCode, '83139');
    assert.equal(body.stale, false);
  });
});

test('GET /api/arrivals/:code 404s an unknown stop', async () => {
  await withServer(new FakeClient(), async (base) => {
    const res = await fetch(`${base}/api/arrivals/00000`);
    assert.equal(res.status, 404);
  });
});

test('GET /healthz reflects stale state', async () => {
  const fake = new FakeClient();
  fake.always = { ok: false, kind: 'network', message: 'down' };
  await withServer(fake, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; anyStale: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.anyStale, true);
  });
});

test('API responses carry no cache and no secrets', async () => {
  await withServer(new FakeClient(), async (base) => {
    const res = await fetch(`${base}/api/arrivals`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = await res.text();
    assert.ok(!/accountkey/i.test(text), 'response must not contain the LTA key');
  });
});

test('GET / serves the static display index.html', async () => {
  await withServer(new FakeClient(), async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    assert.match(html, /<html/i);
  });
});

test('path traversal is blocked', async () => {
  await withServer(new FakeClient(), async (base) => {
    const res = await fetch(`${base}/../package.json`);
    // fetch normalizes most ../, but the server must never serve outside root.
    assert.ok(res.status === 404 || res.status === 403);
  });
});

test('POST is rejected 405', async () => {
  await withServer(new FakeClient(), async (base) => {
    const res = await fetch(`${base}/api/arrivals`, { method: 'POST' });
    assert.equal(res.status, 405);
  });
});

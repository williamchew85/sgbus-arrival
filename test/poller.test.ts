import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Poller } from '../src/poller/poller.ts';
import type { LtaClient, ClientResult } from '../src/lta/client.ts';
import type { StopArrivals } from '../src/lta/types.ts';
import type { StopConfig } from '../src/config.ts';

type Scheduler = (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;

function sampleData(code: string, label: string): StopArrivals {
  return {
    busStopCode: code,
    name: 'Stop ' + code,
    services: [
      {
        serviceNo: '15',
        operator: 'GAS',
        arrivals: [
          { minutes: 3, label, arriving: false, load: 'low', busType: 'single', wheelchair: false },
        ],
      },
    ],
  };
}

/** A fake client whose next result is programmable. */
class FakeClient {
  queue: ClientResult[] = [];
  calls = 0;
  /** When set, every call returns this (overrides queue) — for persistent states. */
  always: ClientResult | null = null;
  async getArrivals(code: string): Promise<ClientResult> {
    this.calls += 1;
    if (this.always !== null) return this.always;
    const next = this.queue.shift();
    if (next !== undefined) return next;
    return { ok: true, data: sampleData(code, '3 min') };
  }
}

const stops: StopConfig[] = [{ busStopCode: '83139', name: 'Tampines', services: [] }];

function makePoller(fake: FakeClient, clock: { t: number }) {
  return new Poller({
    client: fake as unknown as LtaClient,
    stops,
    intervalMs: 1000,
    now: () => clock.t,
  });
}

/** Build a poller with a capture-only scheduler that never auto-fires. */
function makeCapturePoller(
  fake: FakeClient,
  clock: { t: number },
  scheduled: number[],
  maxBackoffMultiplier?: number,
) {
  const sched: Scheduler = (_cb, ms) => {
    scheduled.push(ms);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  };
  return new Poller({
    client: fake as unknown as LtaClient,
    stops,
    intervalMs: 1000,
    ...(maxBackoffMultiplier !== undefined ? { maxBackoffMultiplier } : {}),
    now: () => clock.t,
    setTimeoutFn: sched,
    clearTimeoutFn: () => {},
  });
}

const tickOf = (p: Poller) =>
  (p as unknown as { tick: () => Promise<void> }).tick();

test('refreshStop populates cache on success and clears stale', async () => {
  const fake = new FakeClient();
  const clock = { t: 1000 };
  const p = makePoller(fake, clock);
  await p.refreshStop('83139');
  const e = p.getStop('83139')!;
  assert.equal(e.stale, false);
  assert.equal(e.lastUpdated, 1000);
  assert.equal(e.data!.services[0]!.arrivals[0]!.label, '3 min');
  assert.equal(e.failureCount, 0);
});

test('snapshot serves cached value between fetches (no refetch on read)', async () => {
  const fake = new FakeClient();
  const clock = { t: 5000 };
  const p = makePoller(fake, clock);
  await p.refreshStop('83139');
  const callsAfterFetch = fake.calls;
  p.snapshot();
  p.snapshot();
  p.getStop('83139');
  assert.equal(fake.calls, callsAfterFetch);
});

test('marks stale on failure but preserves last-known data', async () => {
  const fake = new FakeClient();
  const clock = { t: 1000 };
  const p = makePoller(fake, clock);
  await p.refreshStop('83139');
  assert.equal(p.getStop('83139')!.stale, false);
  fake.queue.push({ ok: false, kind: 'http', status: 500, message: 'boom' });
  clock.t = 2000;
  await p.refreshStop('83139');
  const bad = p.getStop('83139')!;
  assert.equal(bad.stale, true);
  assert.equal(bad.failureCount, 1);
  assert.equal(bad.data!.services[0]!.arrivals[0]!.label, '3 min');
  assert.equal(bad.lastUpdated, 1000);
  assert.equal(bad.lastError!.kind, 'http');
});

test('recovers on next success (stale cleared, failureCount reset)', async () => {
  const fake = new FakeClient();
  const clock = { t: 1000 };
  const p = makePoller(fake, clock);
  fake.queue.push({ ok: false, kind: 'network', message: 'down' });
  await p.refreshStop('83139');
  assert.equal(p.getStop('83139')!.stale, true);
  clock.t = 2000;
  fake.queue.push({ ok: true, data: sampleData('83139', '1 min') });
  await p.refreshStop('83139');
  const e = p.getStop('83139')!;
  assert.equal(e.stale, false);
  assert.equal(e.failureCount, 0);
  assert.equal(e.lastUpdated, 2000);
  assert.equal(e.data!.services[0]!.arrivals[0]!.label, '1 min');
});

test('snapshot aggregates lastUpdated and anyStale', async () => {
  const fake = new FakeClient();
  const clock = { t: 7000 };
  const p = makePoller(fake, clock);
  await p.refreshAll();
  const snap = p.snapshot();
  assert.equal(snap.anyStale, false);
  assert.equal(snap.lastUpdated, 7000);
  assert.equal(snap.stops.length, 1);
});

test('scheduleNext grows with consecutive failures via real tick path', async () => {
  const fake = new FakeClient();
  fake.always = { ok: false, kind: 'network', message: 'x' };
  const clock = { t: 0 };
  const scheduled: number[] = [];
  const p = makeCapturePoller(fake, clock, scheduled, 6);
  await p.start();
  assert.equal(scheduled.at(-1), 2000); // 1 failure -> 1+1=2
  await tickOf(p);
  assert.equal(scheduled.at(-1), 3000); // 2 failures -> 1+2=3
  p.stop();
});

test('backoff caps at maxBackoffMultiplier', async () => {
  const fake = new FakeClient();
  fake.always = { ok: false, kind: 'network', message: 'x' };
  const clock = { t: 0 };
  const scheduled: number[] = [];
  const p = makeCapturePoller(fake, clock, scheduled, 4);
  await p.start();
  for (let i = 0; i < 10; i++) {
    await tickOf(p);
  }
  assert.equal(scheduled.at(-1), 4000); // capped at 4
  p.stop();
});

test('schedules at base interval on success', async () => {
  const fake = new FakeClient();
  const clock = { t: 0 };
  const scheduled: number[] = [];
  const p = makeCapturePoller(fake, clock, scheduled);
  await p.start();
  assert.equal(scheduled.at(-1), 1000);
  p.stop();
});

test('stop() prevents further scheduling', async () => {
  const fake = new FakeClient();
  const clock = { t: 0 };
  const scheduled: number[] = [];
  const p = makeCapturePoller(fake, clock, scheduled);
  await p.start();
  const countAfterStart = scheduled.length;
  p.stop();
  await tickOf(p);
  // tick still runs refreshAll, but since not running it must not schedule again.
  assert.equal(scheduled.length, countAfterStart);
});

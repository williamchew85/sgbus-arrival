import type { StopConfig } from '../config.ts';
import type { StopArrivals } from '../lta/types.ts';
import type { LtaClient, ClientErr } from '../lta/client.ts';

/** Cached state for one stop. */
export interface StopCacheEntry {
  busStopCode: string;
  name: string;
  /** Last successfully-fetched arrivals, or null if never fetched OK. */
  data: StopArrivals | null;
  /** Epoch ms of the last successful fetch, or null. */
  lastUpdated: number | null;
  /** True when the most recent fetch attempt failed. */
  stale: boolean;
  /** Last error (for diagnostics), or null. */
  lastError: ClientErr | null;
  /** Consecutive failure count (drives backoff). */
  failureCount: number;
}

/** Snapshot of the whole cache for the API layer. */
export interface CacheSnapshot {
  stops: StopCacheEntry[];
  /** Epoch ms of the newest successful fetch across all stops, or null. */
  lastUpdated: number | null;
  /** True when any stop is currently stale. */
  anyStale: boolean;
}

export interface PollerOptions {
  client: LtaClient;
  stops: StopConfig[];
  /** Base poll interval in ms. */
  intervalMs: number;
  /** Max backoff multiplier applied to the interval after repeated failures (default 6). */
  maxBackoffMultiplier?: number;
  /** Injectable clock (default Date.now). */
  now?: () => number;
  /** Injectable scheduler (default setTimeout/clearTimeout). For fake-timer tests. */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Polls the LTA client for each configured stop on an interval, keeping the
 * latest good result per stop in memory. On failure it marks the stop stale but
 * preserves the last-known data (never blanks), and applies linear backoff on
 * repeated failures. Reads are served from cache — the display never triggers a
 * fetch.
 */
export class Poller {
  private readonly client: LtaClient;
  private readonly intervalMs: number;
  private readonly maxBackoff: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: NonNullable<PollerOptions['setTimeoutFn']>;
  private readonly clearTimeoutFn: NonNullable<PollerOptions['clearTimeoutFn']>;
  private readonly cache = new Map<string, StopCacheEntry>();
  private readonly order: string[] = [];
  private readonly serviceFilter = new Map<string, string[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(opts: PollerOptions) {
    this.client = opts.client;
    this.intervalMs = opts.intervalMs;
    this.maxBackoff = opts.maxBackoffMultiplier ?? 6;
    this.now = opts.now ?? Date.now;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h));

    for (const stop of opts.stops) {
      this.order.push(stop.busStopCode);
      this.serviceFilter.set(stop.busStopCode, stop.services);
      this.cache.set(stop.busStopCode, {
        busStopCode: stop.busStopCode,
        name: stop.name,
        data: null,
        lastUpdated: null,
        stale: true,
        lastError: null,
        failureCount: 0,
      });
    }
  }

  /** Start polling: fetch immediately, then schedule the next tick. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.tick();
  }

  /** Stop polling and clear any pending timer. */
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }

  /** Fetch every configured stop once (used by start and each scheduled tick). */
  async refreshAll(): Promise<void> {
    await Promise.all(this.order.map((code) => this.refreshStop(code)));
  }

  /** Fetch one stop and update its cache entry in place. */
  async refreshStop(code: string): Promise<void> {
    const entry = this.cache.get(code);
    if (entry === undefined) return;
    const filter = this.serviceFilter.get(code) ?? [];
    const result = await this.client.getArrivals(code, entry.name, filter);
    if (result.ok) {
      entry.data = result.data;
      entry.lastUpdated = this.now();
      entry.stale = false;
      entry.lastError = null;
      entry.failureCount = 0;
    } else {
      // Preserve last-known data; just flag stale and remember the error.
      entry.stale = true;
      entry.lastError = result;
      entry.failureCount += 1;
    }
  }

  /** A read-only snapshot for the API layer. */
  snapshot(): CacheSnapshot {
    const stops = this.order.map((code) => ({ ...this.cache.get(code)! }));
    let newest: number | null = null;
    let anyStale = false;
    for (const s of stops) {
      if (s.lastUpdated !== null && (newest === null || s.lastUpdated > newest)) {
        newest = s.lastUpdated;
      }
      if (s.stale) anyStale = true;
    }
    return { stops, lastUpdated: newest, anyStale };
  }

  /** Snapshot for one stop, or undefined if not configured. */
  getStop(code: string): StopCacheEntry | undefined {
    const e = this.cache.get(code);
    return e === undefined ? undefined : { ...e };
  }

  /** Internal: run one refresh cycle and schedule the next with backoff. */
  private async tick(): Promise<void> {
    await this.refreshAll();
    if (!this.running) return;
    this.scheduleNext();
  }

  /** Schedule the next tick; delay grows with the worst current failure streak. */
  private scheduleNext(): void {
    const worstFailures = Math.max(
      0,
      ...this.order.map((c) => this.cache.get(c)?.failureCount ?? 0),
    );
    const multiplier = Math.min(1 + worstFailures, this.maxBackoff);
    const delay = this.intervalMs * multiplier;
    this.timer = this.setTimeoutFn(() => {
      void this.tick();
    }, delay);
  }
}

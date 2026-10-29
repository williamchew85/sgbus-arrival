import type { RawBusArrivalResponse, StopArrivals } from './types.ts';
import { toStopArrivals } from './transform.ts';

const DATAMALL_URL =
  'http://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';

/** Successful fetch + transform. */
export interface ClientOk {
  ok: true;
  data: StopArrivals;
}

/** Any failure, with a machine-readable kind and a human message. */
export interface ClientErr {
  ok: false;
  kind: 'http' | 'network' | 'timeout' | 'parse';
  message: string;
  status?: number;
}

export type ClientResult = ClientOk | ClientErr;

export interface LtaClientOptions {
  accountKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
  /** Injectable clock for deterministic transforms/tests. */
  now?: () => Date;
}

/**
 * Typed client for the LTA BusArrivalv2 endpoint.
 * Every path returns a ClientResult — it never throws to the caller, so the
 * poller/display can always render a stale-but-last-known state.
 */
export class LtaClient {
  private readonly accountKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(opts: LtaClientOptions) {
    this.accountKey = opts.accountKey;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Fetch arrivals for one stop. `name` is the display name; `serviceFilter`
   * (optional) restricts to the given service numbers.
   */
  async getArrivals(
    busStopCode: string,
    name: string,
    serviceFilter: string[] = [],
  ): Promise<ClientResult> {
    const url = `${DATAMALL_URL}?BusStopCode=${encodeURIComponent(busStopCode)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: {
          AccountKey: this.accountKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        return {
          ok: false,
          kind: 'timeout',
          message: `LTA request for stop ${busStopCode} timed out after ${this.timeoutMs}ms.`,
        };
      }
      return {
        ok: false,
        kind: 'network',
        message: `Network error fetching stop ${busStopCode}: ${(err as Error).message}`,
      };
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      return {
        ok: false,
        kind: 'http',
        status: res.status,
        message: `LTA returned HTTP ${res.status} for stop ${busStopCode}.`,
      };
    }

    let raw: RawBusArrivalResponse;
    try {
      raw = (await res.json()) as RawBusArrivalResponse;
    } catch (err) {
      return {
        ok: false,
        kind: 'parse',
        message: `Could not parse LTA JSON for stop ${busStopCode}: ${(err as Error).message}`,
      };
    }

    if (typeof raw !== 'object' || raw === null || !('BusStopCode' in raw)) {
      return {
        ok: false,
        kind: 'parse',
        message: `Unexpected LTA payload shape for stop ${busStopCode}.`,
      };
    }

    const data = toStopArrivals(raw, name, this.now(), serviceFilter);
    return { ok: true, data };
  }
}

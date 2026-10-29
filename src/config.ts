import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A single bus stop to display. `services` empty = show all services at the stop. */
export interface StopConfig {
  busStopCode: string;
  name: string;
  services: string[];
}

export interface AppConfig {
  ltaAccountKey: string;
  port: number;
  host: string;
  pollIntervalMs: number;
  stops: StopConfig[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

interface RawEnv {
  LTA_ACCOUNT_KEY?: string | undefined;
  PORT?: string | undefined;
  HOST?: string | undefined;
  POLL_INTERVAL_SECONDS?: string | undefined;
  STOPS_CONFIG?: string | undefined;
}

/** Parse + validate the stops config JSON text. Throws ConfigError on bad shape. */
export function parseStopsConfig(jsonText: string): StopConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new ConfigError(
      `Stops config is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || !('stops' in parsed)) {
    throw new ConfigError('Stops config must be an object with a "stops" array.');
  }
  const stopsRaw = (parsed as { stops: unknown }).stops;
  if (!Array.isArray(stopsRaw) || stopsRaw.length === 0) {
    throw new ConfigError('Stops config "stops" must be a non-empty array.');
  }

  return stopsRaw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ConfigError(`stops[${i}] must be an object.`);
    }
    const e = entry as Record<string, unknown>;
    const code = e['busStopCode'];
    if (typeof code !== 'string' || !/^\d{5}$/.test(code)) {
      throw new ConfigError(
        `stops[${i}].busStopCode must be a 5-digit string, got ${JSON.stringify(code)}.`,
      );
    }
    const name = typeof e['name'] === 'string' && e['name'].length > 0 ? e['name'] : code;
    const servicesRaw = e['services'];
    let services: string[] = [];
    if (servicesRaw !== undefined) {
      if (
        !Array.isArray(servicesRaw) ||
        !servicesRaw.every((s) => typeof s === 'string')
      ) {
        throw new ConfigError(`stops[${i}].services must be an array of strings.`);
      }
      services = servicesRaw as string[];
    }
    return { busStopCode: code, name, services };
  });
}

/**
 * Load the full app config from environment + the stops JSON file.
 * Fails fast with a ConfigError (clear message) when the LTA key is missing
 * or the stops config is invalid.
 */
export function loadConfig(
  env: RawEnv = process.env,
  cwd: string = process.cwd(),
): AppConfig {
  const key = (env.LTA_ACCOUNT_KEY ?? '').trim();
  if (key === '') {
    throw new ConfigError(
      'LTA_ACCOUNT_KEY is not set. Copy .env.example to .env and paste your ' +
        'LTA DataMall account key (get one at https://datamall.lta.gov.sg/).',
    );
  }

  const port = parsePositiveInt(env.PORT, 3000, 'PORT');
  const host = (env.HOST ?? '127.0.0.1').trim() || '127.0.0.1';
  const pollSeconds = parsePositiveInt(
    env.POLL_INTERVAL_SECONDS,
    25,
    'POLL_INTERVAL_SECONDS',
  );
  if (pollSeconds < 10) {
    throw new ConfigError(
      'POLL_INTERVAL_SECONDS must be >= 10 to stay well under LTA rate limits.',
    );
  }

  const stopsPath = resolve(cwd, (env.STOPS_CONFIG ?? './config/stops.json').trim());
  let stopsText: string;
  try {
    stopsText = readFileSync(stopsPath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `Could not read stops config at ${stopsPath}: ${(err as Error).message}`,
    );
  }
  const stops = parseStopsConfig(stopsText);

  return {
    ltaAccountKey: key,
    port,
    host,
    pollIntervalMs: pollSeconds * 1000,
    stops,
  };
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  label: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${label} must be a positive integer, got "${raw}".`);
  }
  return n;
}

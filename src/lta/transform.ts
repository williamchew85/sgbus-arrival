import type {
  RawBusArrivalResponse,
  RawNextBus,
  RawService,
  LoadLevel,
  Arrival,
  ServiceArrivals,
  StopArrivals,
} from './types.ts';

/** Map an LTA Load code to a display load level. */
export function loadLevel(code: string): LoadLevel {
  switch (code) {
    case 'SEA':
      return 'low'; // Seats Available
    case 'SDA':
      return 'medium'; // Standing Available
    case 'LSD':
      return 'high'; // Limited Standing
    default:
      return 'unknown';
  }
}

/** Map an LTA bus Type code to a display bus type. */
export function busType(code: string): Arrival['busType'] {
  switch (code) {
    case 'SD':
      return 'single';
    case 'DD':
      return 'double';
    case 'BD':
      return 'bendy';
    default:
      return 'unknown';
  }
}

/**
 * Convert one raw NextBus to a display Arrival relative to `now`.
 * Pure: never throws. Empty / malformed time -> minutes null, label "No bus".
 */
export function toArrival(raw: RawNextBus | undefined, now: Date): Arrival {
  const base: Omit<Arrival, 'minutes' | 'label' | 'arriving'> = {
    load: loadLevel(raw?.Load ?? ''),
    busType: busType(raw?.Type ?? ''),
    wheelchair: (raw?.Feature ?? '') === 'WAB',
  };

  const iso = raw?.EstimatedArrival ?? '';
  if (iso.trim() === '') {
    return { minutes: null, label: 'No bus', arriving: false, ...base };
  }

  const arrivalMs = Date.parse(iso);
  if (Number.isNaN(arrivalMs)) {
    return { minutes: null, label: 'No bus', arriving: false, ...base };
  }

  const diffMs = arrivalMs - now.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes <= 0) {
    return { minutes, label: 'Arr', arriving: true, ...base };
  }
  return {
    minutes,
    label: `${minutes} min`,
    arriving: false,
    ...base,
  };
}

/** Transform one raw service into its display arrivals (drops empty trailing slots). */
export function toServiceArrivals(raw: RawService, now: Date): ServiceArrivals {
  const slots = [raw.NextBus, raw.NextBus2, raw.NextBus3];
  const arrivals = slots.map((s) => toArrival(s, now));
  // Keep leading real arrivals; trim trailing "No bus" so the display is clean,
  // but always keep at least one entry so the service still shows "No bus".
  let lastReal = -1;
  for (let i = 0; i < arrivals.length; i++) {
    if (arrivals[i]!.minutes !== null) lastReal = i;
  }
  const kept = lastReal >= 0 ? arrivals.slice(0, lastReal + 1) : [arrivals[0]!];
  return {
    serviceNo: raw.ServiceNo,
    operator: raw.Operator,
    arrivals: kept,
  };
}

/**
 * Transform a full raw BusArrival response into a StopArrivals.
 * `name` is the display name from config; `serviceFilter` (if non-empty) keeps
 * only those service numbers. Pure, never throws; tolerates missing Services.
 */
export function toStopArrivals(
  raw: RawBusArrivalResponse,
  name: string,
  now: Date,
  serviceFilter: string[] = [],
): StopArrivals {
  const services = Array.isArray(raw.Services) ? raw.Services : [];
  const filterSet = new Set(serviceFilter);
  const selected =
    filterSet.size > 0
      ? services.filter((s) => filterSet.has(s.ServiceNo))
      : services;

  const transformed = selected
    .map((s) => toServiceArrivals(s, now))
    // Sort by the soonest real arrival, then by service number.
    .sort((a, b) => {
      const am = firstMinutes(a);
      const bm = firstMinutes(b);
      if (am !== bm) return am - bm;
      return a.serviceNo.localeCompare(b.serviceNo, undefined, { numeric: true });
    });

  return {
    busStopCode: raw.BusStopCode,
    name,
    services: transformed,
  };
}

/** Soonest arrival minutes for sorting; null/absent -> Infinity (sorts last). */
function firstMinutes(s: ServiceArrivals): number {
  for (const a of s.arrivals) {
    if (a.minutes !== null) return a.minutes;
  }
  return Number.POSITIVE_INFINITY;
}

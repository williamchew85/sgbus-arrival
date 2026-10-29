/**
 * Types for the LTA DataMall BusArrivalv2 (v3 BusArrival) endpoint and the
 * display-facing shapes we transform it into.
 *
 * Raw endpoint: GET .../ltaodataservice/v3/BusArrival?BusStopCode=<code>[&ServiceNo=<svc>]
 */

/** Passenger load code reported per bus. */
export type LoadCode = 'SEA' | 'SDA' | 'LSD' | '';
/** Bus body type. */
export type BusTypeCode = 'SD' | 'DD' | 'BD' | '';
/** Accessibility feature. */
export type FeatureCode = 'WAB' | '';

/** One upcoming bus in the raw LTA response. */
export interface RawNextBus {
  OriginCode: string;
  DestinationCode: string;
  EstimatedArrival: string; // ISO 8601, or "" when no bus
  Monitored?: number;
  Latitude: string;
  Longitude: string;
  VisitNumber: string;
  Load: LoadCode;
  Feature: FeatureCode;
  Type: BusTypeCode;
}

/** One service at the stop in the raw LTA response. */
export interface RawService {
  ServiceNo: string;
  Operator: string;
  NextBus: RawNextBus;
  NextBus2: RawNextBus;
  NextBus3: RawNextBus;
}

/** Full raw BusArrivalv2 payload. */
export interface RawBusArrivalResponse {
  'odata.metadata'?: string;
  BusStopCode: string;
  Services: RawService[];
}

// ---------------------------------------------------------------------------
// Display-facing model
// ---------------------------------------------------------------------------

/** Human-readable passenger load bucket. */
export type LoadLevel = 'low' | 'medium' | 'high' | 'unknown';

/** A single arrival, ready for the display. */
export interface Arrival {
  /** Minutes until arrival; null when there is no bus. */
  minutes: number | null;
  /** Display label: "Arr", "1 min", "7 min", or "No bus". */
  label: string;
  /** True when the bus is arriving now (minutes <= 0). */
  arriving: boolean;
  load: LoadLevel;
  /** 'single', 'double', 'bendy', or 'unknown'. */
  busType: 'single' | 'double' | 'bendy' | 'unknown';
  /** Wheelchair accessible. */
  wheelchair: boolean;
}

/** A service with its next arrivals, for the display. */
export interface ServiceArrivals {
  serviceNo: string;
  operator: string;
  arrivals: Arrival[];
}

/** One stop's transformed arrivals. */
export interface StopArrivals {
  busStopCode: string;
  name: string;
  services: ServiceArrivals[];
}

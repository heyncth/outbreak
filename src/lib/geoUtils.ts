import type { LatLng } from "@/types/game";

const EARTH_R = 6371000;
const GPS_MIN_DISPLACEMENT_M = 2.5;
const GPS_ACCURACY_GATE_M = 30;
const SPEED_ANOMALY_MPS = 12;
const EMA_ALPHA = 0.4;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sLng * sLng;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = toRadians(a.lat);
  const φ2 = toRadians(b.lat);
  const Δλ = toRadians(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export type NoiseBand = 0.05 | 0.2 | 0.6 | 1;

export function noiseForSpeed(speedMs: number): NoiseBand {
  if (speedMs < 0.5) return 0.05;
  if (speedMs < 2) return 0.2;
  if (speedMs < 5) return 0.6;
  return 1;
}

export interface GpsSample {
  lat: number;
  lng: number;
  accuracy_m: number;
  speed_ms: number;
  timestamp: number;
}

export interface GpsFilterState {
  lastAccepted: LatLng | null;
  lastSpeed: number;
  acceptedAtMs: number;
}

export interface GpsFilterResult {
  accept: boolean;
  sample: GpsSample | null;
  flags: Array<"LOW_ACCURACY" | "SPEED_ANOMALY">;
}

export function createGpsFilterState(): GpsFilterState {
  return { lastAccepted: null, lastSpeed: 0, acceptedAtMs: 0 };
}

/**
 * 5-stage GPS filter: accuracy gate → deadband → EMA speed → 12 m/s cap → 1 Hz rate limit.
 */
export function filterGps(
  state: GpsFilterState,
  raw: { lat: number; lng: number; accuracy_m: number; speed_ms: number; timestamp: number }
): GpsFilterResult {
  const flags: Array<"LOW_ACCURACY" | "SPEED_ANOMALY"> = [];

  if (raw.accuracy_m > GPS_ACCURACY_GATE_M) {
    return { accept: false, sample: null, flags: ["LOW_ACCURACY"] };
  }

  const point: LatLng = { lat: raw.lat, lng: raw.lng };

  if (state.lastAccepted) {
    const delta = haversineM(state.lastAccepted, point);
    if (delta < GPS_MIN_DISPLACEMENT_M && raw.timestamp - state.acceptedAtMs < 1000) {
      if (raw.timestamp - state.acceptedAtMs < 1000) {
        return { accept: false, sample: null, flags };
      }
    }
  }

  if (raw.timestamp - state.acceptedAtMs < 1000) {
    return { accept: false, sample: null, flags };
  }

  if (raw.speed_ms > SPEED_ANOMALY_MPS) flags.push("SPEED_ANOMALY");
  let speed = state.lastSpeed * (1 - EMA_ALPHA) + raw.speed_ms * EMA_ALPHA;
  if (speed > SPEED_ANOMALY_MPS) speed = SPEED_ANOMALY_MPS;
  if (speed < 0) speed = 0;

  state.lastAccepted = point;
  state.lastSpeed = speed;
  state.acceptedAtMs = raw.timestamp;

  return {
    accept: true,
    sample: {
      lat: raw.lat,
      lng: raw.lng,
      accuracy_m: raw.accuracy_m,
      speed_ms: speed,
      timestamp: raw.timestamp,
    },
    flags,
  };
}

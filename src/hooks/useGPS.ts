"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import {
  createGpsFilterState,
  filterGps,
  noiseForSpeed,
  type GpsFilterState,
} from "@/lib/geoUtils";
import { isDevSim } from "@/lib/devSim";
import { dbg } from "@/lib/debug";
import type { LatLng, TelemetryFlag } from "@/types/game";

export type GpsStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable";

export interface GpsReading extends LatLng {
  accuracy_m: number;
  speed_ms: number;
  noise: number;
  flags: TelemetryFlag[];
  timestamp: number;
}

// One app-wide watch + one filter pipeline: concurrent watchPosition
// instances starve each other (only first receives fixes).
let status: GpsStatus = "idle";
let reading: GpsReading | null = null;
let watchId: number | null = null;
const filterState: GpsFilterState = createGpsFilterState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function applySample(
  raw: {
    lat: number;
    lng: number;
    accuracy_m: number;
    speed_ms: number;
    timestamp: number;
  },
  extraFlags: TelemetryFlag[] = []
): void {
  const result = filterGps(filterState, raw);
  if (!result.accept || !result.sample) {
    if (result.flags.includes("LOW_ACCURACY") && reading) {
      reading = {
        ...reading,
        flags: Array.from(new Set([...reading.flags, "LOW_ACCURACY" as TelemetryFlag])),
      };
    }
    return;
  }
  reading = {
    lat: result.sample.lat,
    lng: result.sample.lng,
    accuracy_m: result.sample.accuracy_m,
    speed_ms: result.sample.speed_ms,
    noise: noiseForSpeed(result.sample.speed_ms),
    flags: Array.from(new Set([...extraFlags, ...result.flags])) as TelemetryFlag[],
    timestamp: result.sample.timestamp,
  };
}

function ensureWatch(): void {
  if (watchId !== null) return;
  if (!("geolocation" in navigator)) {
    status = "unavailable";
    emit();
    return;
  }
  status = "requesting";
  dbg("gps watch start", { devsim: isDevSim() });
  emit();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      status = "granted";
      dbg("gps fix", pos.coords.latitude, pos.coords.longitude, `acc=${pos.coords.accuracy}`);
      applySample({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
        speed_ms: pos.coords.speed ?? 0,
        timestamp: pos.timestamp,
      });
      emit();
    },
    (err) => {
      status = err.code === err.PERMISSION_DENIED ? "denied" : "unavailable";
      dbg("gps error", err.code, err.message);
      emit();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

export function useGPS() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  // false on SSR + first client render — avoids hydration mismatch
  const [devSim, setDevSim] = useState(false);

  useEffect(() => {
    listeners.add(force);
    setDevSim(isDevSim());
    return () => {
      listeners.delete(force);
    };
  }, [force]);

  const start = useCallback(() => {
    ensureWatch();
  }, []);

  const stop = useCallback(() => {
    if (watchId !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    status = "idle";
    emit();
  }, []);

  return { status, reading, start, stop, devSim };
}

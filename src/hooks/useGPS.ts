"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createGpsFilterState,
  filterGps,
  noiseForSpeed,
  type GpsFilterState,
} from "@/lib/geoUtils";
import { isDevSim } from "@/lib/devSim";
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

export function useGPS() {
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [reading, setReading] = useState<GpsReading | null>(null);
  const [devSim, setDevSim] = useState(false);
  const filterRef = useRef<GpsFilterState>(createGpsFilterState());
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    setDevSim(isDevSim());
  }, []);

  const applySample = useCallback(
    (
      raw: {
        lat: number;
        lng: number;
        accuracy_m: number;
        speed_ms: number;
        timestamp: number;
      },
      extraFlags: TelemetryFlag[] = []
    ) => {
      const result = filterGps(filterRef.current, raw);
      if (!result.accept || !result.sample) {
        if (result.flags.includes("LOW_ACCURACY")) {
          setReading((prev) =>
            prev
              ? {
                  ...prev,
                  flags: Array.from(
                    new Set([...prev.flags, "LOW_ACCURACY" as TelemetryFlag])
                  ),
                }
              : null
          );
        }
        return;
      }
      setReading({
        lat: result.sample.lat,
        lng: result.sample.lng,
        accuracy_m: result.sample.accuracy_m,
        speed_ms: result.sample.speed_ms,
        noise: noiseForSpeed(result.sample.speed_ms),
        flags: Array.from(
          new Set([...extraFlags, ...result.flags])
        ) as TelemetryFlag[],
        timestamp: result.sample.timestamp,
      });
    },
    []
  );

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    if (watchIdRef.current !== null) return;
    setStatus("requesting");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("granted");
        applySample({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          speed_ms: pos.coords.speed ?? 0,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        setStatus(
          err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }, [applySample]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setStatus("idle");
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { status, reading, start, stop, devSim };
}

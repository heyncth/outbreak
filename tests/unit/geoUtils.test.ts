import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  createGpsFilterState,
  filterGps,
  haversineM,
  noiseForSpeed,
} from "@/lib/geoUtils";

const DN = { lat: 16.054407, lng: 108.202167 };

describe("haversineM", () => {
  it("zero distance", () => {
    expect(haversineM(DN, DN)).toBe(0);
  });

  it("~111.2 m per 0.001 lat", () => {
    const d = haversineM(DN, { lat: DN.lat + 0.001, lng: DN.lng });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe("bearingDeg", () => {
  it("north", () => {
    expect(bearingDeg(DN, { lat: DN.lat + 0.001, lng: DN.lng })).toBeCloseTo(0, 0);
  });
  it("east", () => {
    expect(bearingDeg(DN, { lat: DN.lat, lng: DN.lng + 0.001 })).toBeCloseTo(90, 0);
  });
});

describe("noiseForSpeed", () => {
  it("bands match spec", () => {
    expect(noiseForSpeed(0)).toBe(0.05);
    expect(noiseForSpeed(1)).toBe(0.2);
    expect(noiseForSpeed(3)).toBe(0.6);
    expect(noiseForSpeed(6)).toBe(1);
  });
});

describe("filterGps 5 stages", () => {
  it("rejects accuracy > 30 m", () => {
    const s = createGpsFilterState();
    const r = filterGps(s, { lat: 1, lng: 1, accuracy_m: 35, speed_ms: 1, timestamp: 1000 });
    expect(r.accept).toBe(false);
    expect(r.flags).toContain("LOW_ACCURACY");
  });

  it("rate-limits to 1 Hz", () => {
    const s = createGpsFilterState();
    const t0 = 1_000_000;
    const first = filterGps(s, { lat: DN.lat, lng: DN.lng, accuracy_m: 5, speed_ms: 1, timestamp: t0 });
    expect(first.accept).toBe(true);
    const second = filterGps(s, { lat: DN.lat + 0.001, lng: DN.lng, accuracy_m: 5, speed_ms: 1, timestamp: t0 + 200 });
    expect(second.accept).toBe(false);
    const third = filterGps(s, { lat: DN.lat + 0.002, lng: DN.lng, accuracy_m: 5, speed_ms: 1, timestamp: t0 + 1100 });
    expect(third.accept).toBe(true);
  });

  it("caps speed at 12 m/s with SPEED_ANOMALY", () => {
    const s = createGpsFilterState();
    const r = filterGps(s, { lat: DN.lat, lng: DN.lng, accuracy_m: 5, speed_ms: 30, timestamp: 5_000_000 });
    expect(r.accept).toBe(true);
    expect(r.sample?.speed_ms).toBeLessThanOrEqual(12);
    expect(r.flags).toContain("SPEED_ANOMALY");
  });

  it("deadband rejects < 2.5 m moves within same second", () => {
    const s = createGpsFilterState();
    filterGps(s, { lat: DN.lat, lng: DN.lng, accuracy_m: 5, speed_ms: 0, timestamp: 9_000_000 });
    const r = filterGps(s, { lat: DN.lat + 0.00001, lng: DN.lng, accuracy_m: 5, speed_ms: 0, timestamp: 9_000_500 });
    expect(r.accept).toBe(false);
  });

  it("deadband rejects stationary readings even after 1s", () => {
    const s = createGpsFilterState();
    filterGps(s, { lat: DN.lat, lng: DN.lng, accuracy_m: 5, speed_ms: 0, timestamp: 9_000_000 });
    const r = filterGps(s, { lat: DN.lat, lng: DN.lng, accuracy_m: 5, speed_ms: 0, timestamp: 9_010_000 });
    expect(r.accept).toBe(false);
  });

  it("EMA smooths speed", () => {
    const s = createGpsFilterState();
    filterGps(s, { lat: DN.lat, lng: DN.lng, accuracy_m: 5, speed_ms: 10, timestamp: 11_000_000 });
    const r = filterGps(s, { lat: DN.lat + 0.001, lng: DN.lng, accuracy_m: 5, speed_ms: 0, timestamp: 12_000_000 });
    expect(r.sample?.speed_ms).toBeGreaterThan(0);
    expect(r.sample?.speed_ms).toBeLessThan(10);
  });
});

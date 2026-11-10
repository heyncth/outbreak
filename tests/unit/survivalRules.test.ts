import { describe, expect, it } from "vitest";
import {
  KNOCK_SEC,
  MAX_HP_FLOOR,
  RESCUE_DIST_M,
  RESCUE_HOLD_MS,
  RESCUE_HP,
  ZONE_COOLDOWN_MS,
  ZONE_HEAL_PER_S,
  canRescue,
  hostZoneCooldownOk,
  inZone,
  knockRemainingSec,
  onKnockTimeout,
  shouldEndAllKnocked,
  shouldEndSolo,
  zoneHeal,
} from "@/engine/survivalRules";

describe("knock timer", () => {
  it("counts down 60s", () => {
    const t0 = 1_000_000;
    expect(knockRemainingSec(t0, t0)).toBe(KNOCK_SEC);
    expect(knockRemainingSec(t0, t0 + 15_000)).toBe(45);
    expect(knockRemainingSec(t0, t0 + 60_000)).toBe(0);
    expect(knockRemainingSec(t0, t0 + 90_000)).toBe(0);
  });
});

describe("onKnockTimeout", () => {
  it("applies −20 max HP", () => {
    expect(onKnockTimeout(100)).toEqual({ maxHp: 80, hp: 80 });
    expect(onKnockTimeout(80)).toEqual({ maxHp: 60, hp: 60 });
  });

  it("floors at 20", () => {
    expect(onKnockTimeout(30)).toEqual({ maxHp: MAX_HP_FLOOR, hp: MAX_HP_FLOOR });
    expect(onKnockTimeout(20)).toEqual({ maxHp: MAX_HP_FLOOR, hp: MAX_HP_FLOOR });
  });
});

describe("canRescue", () => {
  it("requires ALIVE rescuer, KNOCKED victim, dist ≤ 10", () => {
    expect(canRescue(10, "ALIVE", "KNOCKED")).toBe(true);
    expect(canRescue(10.1, "ALIVE", "KNOCKED")).toBe(false);
    expect(canRescue(5, "KNOCKED", "KNOCKED")).toBe(false);
    expect(canRescue(5, "ALIVE", "ALIVE")).toBe(false);
    expect(canRescue(5, "ALIVE", "DISCONNECTED")).toBe(false);
    expect(RESCUE_DIST_M).toBe(10);
    expect(RESCUE_HOLD_MS).toBe(3000);
    expect(RESCUE_HP).toBe(50);
  });
});

describe("shouldEndAllKnocked", () => {
  it("ends when every connected player is KNOCKED", () => {
    expect(
      shouldEndAllKnocked([
        { state: "KNOCKED" },
        { state: "KNOCKED" },
      ])
    ).toBe(true);
  });

  it("does not end while any ALIVE remains", () => {
    expect(
      shouldEndAllKnocked([
        { state: "KNOCKED" },
        { state: "ALIVE" },
      ])
    ).toBe(false);
  });

  it("ignores DISCONNECTED for the end set", () => {
    expect(
      shouldEndAllKnocked([
        { state: "KNOCKED" },
        { state: "DISCONNECTED" },
      ])
    ).toBe(true);
  });

  it("does not end on empty / all-disconnected", () => {
    expect(shouldEndAllKnocked([])).toBe(false);
    expect(shouldEndAllKnocked([{ state: "DISCONNECTED" }])).toBe(false);
  });
});

describe("shouldEndSolo", () => {
  it("instant end when solo is KNOCKED", () => {
    expect(shouldEndSolo(1, "KNOCKED")).toBe(true);
    expect(shouldEndSolo(1, "ALIVE")).toBe(false);
    expect(shouldEndSolo(2, "KNOCKED")).toBe(false);
  });
});

describe("safe zone", () => {
  it("membership by radius", () => {
    expect(inZone(30, 30)).toBe(true);
    expect(inZone(30.1, 30)).toBe(false);
  });

  it("heals +2/s capped at max", () => {
    expect(zoneHeal(50, 100, 1)).toBe(52);
    expect(zoneHeal(99, 100, 1)).toBe(100);
    expect(zoneHeal(100, 100, 1)).toBe(100);
    expect(ZONE_HEAL_PER_S).toBe(2);
  });

  it("host cooldown 10 min", () => {
    const t0 = 0;
    expect(hostZoneCooldownOk(null, t0)).toBe(true);
    expect(hostZoneCooldownOk(t0, t0 + ZONE_COOLDOWN_MS - 1)).toBe(false);
    expect(hostZoneCooldownOk(t0, t0 + ZONE_COOLDOWN_MS)).toBe(true);
  });
});

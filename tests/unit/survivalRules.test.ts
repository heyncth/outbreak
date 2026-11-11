import { describe, expect, it } from "vitest";
import {
  KNOCK_SEC,
  MAX_HP_FLOOR,
  RESCUE_DIST_M,
  RESCUE_HOLD_MS,
  RESCUE_HP,
  ZONE_HEAL_PER_S,
  onKnockTimeout,
  shouldEndAllKnocked,
  shouldEndSolo,
  zoneHeal,
} from "@/engine/survivalRules";

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

describe("rescue constants", () => {
  it("match spec", () => {
    expect(KNOCK_SEC).toBe(60);
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

describe("zoneHeal", () => {
  it("heals +2/s capped at max", () => {
    expect(zoneHeal(50, 100, 1)).toBe(52);
    expect(zoneHeal(99, 100, 1)).toBe(100);
    expect(zoneHeal(100, 100, 1)).toBe(100);
    expect(ZONE_HEAL_PER_S).toBe(2);
  });
});

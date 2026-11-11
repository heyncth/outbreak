import type { PlayerState } from "@/types/game";

export const KNOCK_SEC = 60;
export const RESCUE_DIST_M = 10;
export const RESCUE_HOLD_MS = 3000;
export const RESCUE_HP = 50;
export const MAX_HP_PENALTY = 20;
export const MAX_HP_FLOOR = 20;
export const ZONE_RADIUS_M = 30;
export const ZONE_HEAL_PER_S = 2;
export const ZONE_TTL_SEC = 180;
export const ZONE_COOLDOWN_MS = 10 * 60 * 1000;
export const MELEE_RANGE_M = 3.5;

/** 60s timeout: permanent −20 max HP, floor 20; HP restored to new max. */
export function onKnockTimeout(maxHp: number): { maxHp: number; hp: number } {
  const next = Math.max(MAX_HP_FLOOR, maxHp - MAX_HP_PENALTY);
  return { maxHp: next, hp: next };
}

/** All connected (non-DISCONNECTED) players KNOCKED and none ALIVE → end. */
export function shouldEndAllKnocked(
  players: ReadonlyArray<{ state: PlayerState }>
): boolean {
  const connected = players.filter((p) => p.state !== "DISCONNECTED");
  if (connected.length === 0) return false;
  return connected.every((p) => p.state === "KNOCKED");
}

/** Solo: sole player KNOCKED → instant end (no 60s wait). */
export function shouldEndSolo(
  playerCount: number,
  selfState: PlayerState
): boolean {
  return playerCount === 1 && selfState === "KNOCKED";
}

export function zoneHeal(hp: number, maxHp: number, dtSec: number): number {
  return Math.min(maxHp, hp + ZONE_HEAL_PER_S * dtSec);
}

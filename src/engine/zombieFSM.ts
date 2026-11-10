import type { ZombieState, ZombieType } from "@/types/game";

export const MELEE_RANGE_M = 3.5;
export const K_HEARING_M = 45;
export const SWARM_RADIUS_M = 100;
export const SEARCH_TIMEOUT_MS = 15_000;
export const IDLE_TIMEOUT_MS = 2_000;
export const NOISE_SPIKE_BAND = 1.4;

export interface ZombieTypeParams {
  wanderSpeed: number;
  chaseSpeed: number;
  rBase: number;
  dps: number;
}

export const ZOMBIE_PARAMS: Record<ZombieType, ZombieTypeParams> = {
  WALKER: { wanderSpeed: 0.8, chaseSpeed: 1.6, rBase: 25, dps: 10 },
  RUNNER: { wanderSpeed: 1.2, chaseSpeed: 3.2, rBase: 30, dps: 12 },
  STALKER: { wanderSpeed: 1.4, chaseSpeed: 2.4, rBase: 40, dps: 15 },
  SCREAMER: { wanderSpeed: 0.7, chaseSpeed: 1.2, rBase: 35, dps: 5 },
  BRUTE: { wanderSpeed: 0.6, chaseSpeed: 1.3, rBase: 20, dps: 35 },
};

/** R_detect = R_base + noise * K_hearing (LOS=1.0 V1). */
export function detectRadius(rBase: number, noise: number): number {
  return rBase + noise * K_HEARING_M;
}

export type TargetIssue =
  | "NONE"
  | "KNOCKED_OR_DC"
  | "SAFE_ZONE"
  | "OUT_OF_RANGE"
  | "NO_TARGET";

export interface FsmContext {
  state: ZombieState;
  /** Distance to current target; Infinity when none. */
  dist: number;
  rDetect: number;
  hasTarget: boolean;
  targetIssue: TargetIssue;
  /** Screamer SWARM pull within 100 m. */
  swarmCall: boolean;
  /** Noise spike in (R_detect, 1.4 × R_detect]. */
  noiseSpike: boolean;
  searchExpired: boolean;
  idleExpired: boolean;
}

const PURSUING: ReadonlySet<ZombieState> = new Set(["CHASE", "ATTACK", "SWARM"]);
const PATROL: ReadonlySet<ZombieState> = new Set(["WANDER", "INVESTIGATE", "SEARCH"]);

/**
 * Priority (TDD §6.3) — prevents CHASE↔SEARCH ping-pong:
 * target invalid/safe → melee → swarm → detect → noise → timers.
 */
export function transition(ctx: FsmContext): ZombieState {
  const { state } = ctx;

  // 1. Target issues
  if (ctx.targetIssue === "KNOCKED_OR_DC") return "WANDER";
  if (
    ctx.targetIssue === "SAFE_ZONE" ||
    ctx.targetIssue === "OUT_OF_RANGE" ||
    ctx.targetIssue === "NO_TARGET"
  ) {
    if (PURSUING.has(state)) return "SEARCH";
  }

  const engaging =
    ctx.hasTarget && ctx.targetIssue === "NONE" && Number.isFinite(ctx.dist);

  if (engaging) {
    // 2. Melee
    if (ctx.dist <= MELEE_RANGE_M) return "ATTACK";
    // 4. Detect (SWARM holder with own target in sight → CHASE)
    if (ctx.dist <= ctx.rDetect) return "CHASE";
    // 3. Swarm pull when not in own detect range
    if (ctx.swarmCall && (PATROL.has(state) || state === "SWARM")) return "SWARM";
    // 5. Noise spike
    if (ctx.noiseSpike && PATROL.has(state)) return "INVESTIGATE";
  } else if (ctx.swarmCall && (state === "WANDER" || state === "INVESTIGATE")) {
    return "SWARM";
  }

  // 6. Timers (no live engage)
  if (!engaging) {
    if (
      (state === "SEARCH" || state === "INVESTIGATE" || state === "SWARM") &&
      ctx.searchExpired
    ) {
      return "WANDER";
    }
    if (state === "IDLE" && ctx.idleExpired) return "WANDER";
  }

  return state;
}

/** True when this zombie should emit SWARM pull (Screamer entered CHASE). */
export function emitsSwarm(type: ZombieType, from: ZombieState, to: ZombieState): boolean {
  return type === "SCREAMER" && from !== "CHASE" && to === "CHASE";
}

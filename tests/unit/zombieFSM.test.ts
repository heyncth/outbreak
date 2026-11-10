import { describe, expect, it } from "vitest";
import {
  transition,
  detectRadius,
  ZOMBIE_PARAMS,
  emitsSwarm,
  MELEE_RANGE_M,
  type FsmContext,
} from "@/engine/zombieFSM";
import type { ZombieState } from "@/types/game";

function ctx(partial: Partial<FsmContext>): FsmContext {
  return {
    state: "WANDER",
    dist: Infinity,
    rDetect: 40,
    hasTarget: false,
    targetIssue: "NO_TARGET",
    swarmCall: false,
    noiseSpike: false,
    searchExpired: false,
    idleExpired: false,
    ...partial,
  };
}

describe("ZOMBIE_PARAMS", () => {
  it("has five types with TDD §5 values", () => {
    expect(Object.keys(ZOMBIE_PARAMS).sort()).toEqual([
      "BRUTE",
      "RUNNER",
      "SCREAMER",
      "STALKER",
      "WALKER",
    ]);
    expect(ZOMBIE_PARAMS.WALKER).toEqual({
      wanderSpeed: 0.8,
      chaseSpeed: 1.6,
      rBase: 25,
      dps: 10,
    });
    expect(ZOMBIE_PARAMS.RUNNER.rBase).toBe(30);
    expect(ZOMBIE_PARAMS.STALKER.dps).toBe(15);
    expect(ZOMBIE_PARAMS.SCREAMER.rBase).toBe(35);
    expect(ZOMBIE_PARAMS.BRUTE.dps).toBe(35);
  });
});

describe("detectRadius", () => {
  it("R_base + noise × 45", () => {
    expect(detectRadius(25, 0.05)).toBeCloseTo(25 + 0.05 * 45);
    expect(detectRadius(30, 1)).toBeCloseTo(75);
  });
});

describe("transition — TDD §6.3 priority table", () => {
  it("target KNOCKED_OR_DC → WANDER from CHASE", () => {
    expect(
      transition(ctx({ state: "CHASE", hasTarget: true, targetIssue: "KNOCKED_OR_DC", dist: 5 }))
    ).toBe("WANDER");
  });

  it("target in SAFE_ZONE while CHASE/ATTACK → SEARCH", () => {
    expect(
      transition(ctx({ state: "CHASE", hasTarget: true, targetIssue: "SAFE_ZONE", dist: 5 }))
    ).toBe("SEARCH");
    expect(
      transition(ctx({ state: "ATTACK", hasTarget: true, targetIssue: "SAFE_ZONE", dist: 2 }))
    ).toBe("SEARCH");
  });

  it("target OUT_OF_RANGE while CHASE → SEARCH", () => {
    expect(
      transition(
        ctx({ state: "CHASE", hasTarget: true, targetIssue: "OUT_OF_RANGE", dist: 999 })
      )
    ).toBe("SEARCH");
  });

  it("lost target while pursuing → SEARCH", () => {
    expect(transition(ctx({ state: "CHASE", hasTarget: false, targetIssue: "NO_TARGET" }))).toBe(
      "SEARCH"
    );
    expect(transition(ctx({ state: "ATTACK", hasTarget: false, targetIssue: "NO_TARGET" }))).toBe(
      "SEARCH"
    );
  });

  it("dist ≤ 3.5 → ATTACK", () => {
    expect(
      transition(
        ctx({
          state: "CHASE",
          hasTarget: true,
          targetIssue: "NONE",
          dist: MELEE_RANGE_M,
        })
      )
    ).toBe("ATTACK");
    expect(
      transition(ctx({ state: "WANDER", hasTarget: true, targetIssue: "NONE", dist: 2 }))
    ).toBe("ATTACK");
  });

  it("swarm call on patrol → SWARM; own target in sight wins → CHASE", () => {
    expect(
      transition(
        ctx({ state: "WANDER", swarmCall: true, hasTarget: false, targetIssue: "NO_TARGET" })
      )
    ).toBe("SWARM");
    expect(
      transition(
        ctx({
          state: "WANDER",
          swarmCall: true,
          hasTarget: true,
          targetIssue: "NONE",
          dist: 20,
          rDetect: 40,
        })
      )
    ).toBe("CHASE");
  });

  it("dist ≤ R_detect → CHASE", () => {
    expect(
      transition(
        ctx({ state: "WANDER", hasTarget: true, targetIssue: "NONE", dist: 30, rDetect: 40 })
      )
    ).toBe("CHASE");
  });

  it("noise spike in band → INVESTIGATE", () => {
    expect(
      transition(
        ctx({
          state: "WANDER",
          hasTarget: true,
          targetIssue: "NONE",
          dist: 50,
          rDetect: 40,
          noiseSpike: true,
        })
      )
    ).toBe("INVESTIGATE");
  });

  it("search timeout → WANDER", () => {
    expect(
      transition(ctx({ state: "SEARCH", searchExpired: true, hasTarget: false }))
    ).toBe("WANDER");
    expect(
      transition(ctx({ state: "INVESTIGATE", searchExpired: true, hasTarget: false }))
    ).toBe("WANDER");
  });

  it("idle timer → WANDER", () => {
    expect(transition(ctx({ state: "IDLE", idleExpired: true }))).toBe("WANDER");
  });

  it("IDLE without timer stays IDLE", () => {
    expect(transition(ctx({ state: "IDLE" }))).toBe("IDLE");
  });

  it("no engage → keep state (no CHASE↔SEARCH ping-pong)", () => {
    const s: ZombieState = "WANDER";
    expect(transition(ctx({ state: s }))).toBe("WANDER");
    expect(
      transition(ctx({ state: "SEARCH", hasTarget: false, targetIssue: "NO_TARGET" }))
    ).toBe("SEARCH");
  });

  it("CHASE with valid target in range stays CHASE when dist > melee", () => {
    expect(
      transition(
        ctx({ state: "CHASE", hasTarget: true, targetIssue: "NONE", dist: 10, rDetect: 40 })
      )
    ).toBe("CHASE");
  });

  it("ATTACK target escaped to range → CHASE", () => {
    expect(
      transition(
        ctx({ state: "ATTACK", hasTarget: true, targetIssue: "NONE", dist: 10, rDetect: 40 })
      )
    ).toBe("CHASE");
  });
});

describe("emitsSwarm", () => {
  it("only Screamer entering CHASE", () => {
    expect(emitsSwarm("SCREAMER", "WANDER", "CHASE")).toBe(true);
    expect(emitsSwarm("SCREAMER", "CHASE", "ATTACK")).toBe(false);
    expect(emitsSwarm("WALKER", "WANDER", "CHASE")).toBe(false);
  });
});

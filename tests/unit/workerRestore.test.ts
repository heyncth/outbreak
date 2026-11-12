import { describe, expect, it } from "vitest";
import { restoreFromTick } from "@/engine/workerRestore";
import type { WorldStateTick } from "@/types/game";

const tick: WorldStateTick = {
  tick_id: 42,
  elapsed_sec: 120,
  pathfinding_mode: "GRAPH_ASTAR",
  players: [
    {
      player_id: "p1",
      nickname: "A",
      state: "KNOCKED",
      hp: 0,
      max_hp: 80,
      lat: 16.05,
      lng: 108.2,
      noise: 0.2,
      in_safe_zone: false,
      knocked_remaining_sec: 45,
    },
    {
      player_id: "p2",
      nickname: "B",
      state: "ALIVE",
      hp: 100,
      max_hp: 100,
      lat: 16.051,
      lng: 108.201,
      noise: 0.05,
      in_safe_zone: true,
      knocked_remaining_sec: null,
    },
  ],
  zombies: [
    {
      id: "z1",
      type: "RUNNER",
      state: "CHASE",
      lat: 16.06,
      lng: 108.21,
      heading_deg: 90,
      target_player_id: "p2",
    },
  ],
  safe_zones: [
    {
      id: "sz_0",
      zone_type: "SYSTEM",
      lat: 16.07,
      lng: 108.22,
      radius_m: 30,
      expires_in_sec: null,
    },
    {
      id: "sz_host",
      zone_type: "HOST_CREATED",
      lat: 16.08,
      lng: 108.23,
      radius_m: 30,
      expires_in_sec: 120,
    },
  ],
  quest: null,
};

describe("restoreFromTick", () => {
  it("seeds players, zones, elapsed from snapshot", () => {
    const now = 1_000_000_000_000;
    const r = restoreFromTick(tick, now);
    expect(r.players).toHaveLength(2);
    expect(r.players[0]?.state).toBe("KNOCKED");
    expect(r.players[0]?.knocked_remaining_sec).toBe(45);
    expect(r.players[1]?.in_safe_zone).toBe(true);
    expect(r.zones).toHaveLength(2);
    expect(r.zones[1]?.expires_in_sec).toBe(120);
    expect(r.startedAt).toBe(now - 120_000);
    expect(r.tickId).toBe(42);
  });

  it("resets zombie path/FSM timers but keeps pos/type/target", () => {
    const r = restoreFromTick(tick, 1_000_000_000_000);
    const z = r.zombies[0];
    expect(z).toBeDefined();
    expect(z?.type).toBe("RUNNER");
    expect(z?.state).toBe("CHASE");
    expect(z?.lat).toBe(16.06);
    expect(z?.target_player_id).toBe("p2");
    expect(z?.path).toEqual([]);
    expect(z?.needsPath).toBe(true);
    expect(z?.stateEnteredAt).toBe(1_000_000_000_000);
  });

  it("does not mutate input tick", () => {
    const before = JSON.stringify(tick);
    restoreFromTick(tick, 1);
    expect(JSON.stringify(tick)).toBe(before);
  });
});

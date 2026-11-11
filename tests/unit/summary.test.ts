import { describe, expect, it } from "vitest";
import { buildMatchSummary } from "@/lib/summary";
import type { MatchPlayerStat } from "@/types/game";

const players: MatchPlayerStat[] = [
  {
    player_id: "p1",
    nickname: "Alice",
    distance_m: 1200,
    max_speed_ms: 3,
    rescues_count: 2,
    max_hp: 80,
    state: "ALIVE",
  },
  {
    player_id: "p2",
    nickname: "Bob",
    distance_m: 800,
    max_speed_ms: 2,
    rescues_count: 1,
    max_hp: 100,
    state: "KNOCKED",
  },
];

describe("buildMatchSummary", () => {
  it("aggregates totals from player rows", () => {
    const s = buildMatchSummary(
      { started_at: new Date(Date.now() - 90_000).toISOString() },
      players,
      { knockdowns: 4, autoRespawns: 1, pathfinding_mode: "GRAPH_ASTAR" },
      "HOST_ENDED"
    );
    expect(s.gameplay_metrics.total_team_distance_m).toBe(2000);
    expect(s.gameplay_metrics.successful_rescues).toBe(3);
    expect(s.gameplay_metrics.total_knockdowns).toBe(4);
    expect(s.gameplay_metrics.auto_respawns_at_safezone).toBe(1);
    expect(s.gameplay_metrics.end_reason).toBe("HOST_ENDED");
    expect(s.gameplay_metrics.match_duration_sec).toBeGreaterThanOrEqual(89);
    expect(s.tech_metrics.pathfinding_mode).toBe("GRAPH_ASTAR");
    expect(s.players).toHaveLength(2);
  });

  it("zero duration without started_at, drops bad pathfinding mode", () => {
    const s = buildMatchSummary({ started_at: null }, [], { knockdowns: 0, autoRespawns: 0 }, "ALL_KNOCKED");
    expect(s.gameplay_metrics.match_duration_sec).toBe(0);
    expect(s.gameplay_metrics.total_knockdowns).toBe(0);
    expect(s.tech_metrics.pathfinding_mode).toBeUndefined();
    expect(s.gameplay_metrics.end_reason).toBe("ALL_KNOCKED");
  });
});

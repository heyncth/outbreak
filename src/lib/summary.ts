import type { EndReason, MatchPlayerStat, MatchSummaryJson } from "@/types/game";

interface SummaryRoom {
  started_at: string | null;
}

interface SummaryCounts {
  knockdowns: number;
  autoRespawns: number;
  pathfinding_mode?: string;
}

/** Pure summary builder — unit-tested, used by /api/rooms/end. */
export function buildMatchSummary(
  room: SummaryRoom,
  playerStats: MatchPlayerStat[],
  counts: SummaryCounts,
  endReason: EndReason
): MatchSummaryJson {
  const durationSec = room.started_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(room.started_at)) / 1000))
    : 0;

  return {
    tech_metrics: {
      pathfinding_mode:
        counts.pathfinding_mode === "DIRECT_VECTOR_FALLBACK" ||
        counts.pathfinding_mode === "GRAPH_ASTAR"
          ? counts.pathfinding_mode
          : undefined,
    },
    gameplay_metrics: {
      match_duration_sec: durationSec,
      total_team_distance_m: playerStats.reduce((a, p) => a + p.distance_m, 0),
      total_knockdowns: counts.knockdowns,
      successful_rescues: playerStats.reduce((a, p) => a + p.rescues_count, 0),
      auto_respawns_at_safezone: counts.autoRespawns,
      end_reason: endReason,
    },
    players: playerStats,
  };
}

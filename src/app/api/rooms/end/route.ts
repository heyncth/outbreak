import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  dbMessage,
  isValidUuid,
  rateLimit,
} from "@/lib/api";
import { broadcastAction, broadcastLobby } from "@/lib/broadcast";
import { serverClient } from "@/lib/supabase";
import type { EndReason, MatchSummaryJson, MatchPlayerStat } from "@/types/game";

interface EndBodyExtra {
  knockdowns?: number;
  auto_respawns?: number;
  pathfinding_mode?: string;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const {
    room_id,
    requester_player_id,
    reason,
    knockdowns,
    auto_respawns,
    pathfinding_mode,
  } = (body ?? {}) as Record<string, unknown> & EndBodyExtra;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(requester_player_id)) {
    return apiError("VALIDATION_ERROR", "Invalid requester_player_id");
  }
  const endReason: EndReason =
    reason === "ALL_KNOCKED" || reason === "HOST_ENDED" ? reason : "HOST_ENDED";
  if (!rateLimit(`end:${requester_player_id}`, 5)) {
    return apiError("RATE_LIMITED", "Too many end attempts");
  }

  const sb = serverClient();

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status, host_player_id, room_code, started_at")
    .eq("id", room_id)
    .maybeSingle();

  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");

  if (endReason === "HOST_ENDED" && room.host_player_id !== requester_player_id) {
    return apiError("NOT_HOST", "Only the host can end the match");
  }
  if (room.status !== "ACTIVE") {
    return apiError("ROOM_CONFLICT", "Room is not ACTIVE");
  }

  // snapshot stats before end_match (players keep rows until rematch)
  const { data: players, error: pErr } = await sb
    .from("room_players")
    .select("player_id, nickname, distance_m, max_speed_ms, rescues_count, max_hp, state")
    .eq("room_id", room_id);
  if (pErr) return apiError("DB_UNAVAILABLE", dbMessage(pErr));

  const rows = players ?? [];
  const playerStats: MatchPlayerStat[] = rows.map((p) => ({
    player_id: p.player_id,
    nickname: p.nickname,
    distance_m: Number(p.distance_m) || 0,
    max_speed_ms: Number(p.max_speed_ms) || 0,
    rescues_count: Number(p.rescues_count) || 0,
    max_hp: Number(p.max_hp) || 100,
    state: p.state as MatchPlayerStat["state"],
  }));

  const durationSec = room.started_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(room.started_at)) / 1000))
    : 0;

  const summary: MatchSummaryJson = {
    tech_metrics: {
      pathfinding_mode:
        pathfinding_mode === "DIRECT_VECTOR_FALLBACK" ||
        pathfinding_mode === "GRAPH_ASTAR"
          ? pathfinding_mode
          : undefined,
    },
    gameplay_metrics: {
      match_duration_sec: durationSec,
      total_team_distance_m: playerStats.reduce((a, p) => a + p.distance_m, 0),
      total_knockdowns: typeof knockdowns === "number" ? knockdowns : 0,
      successful_rescues: playerStats.reduce((a, p) => a + p.rescues_count, 0),
      auto_respawns_at_safezone: typeof auto_respawns === "number" ? auto_respawns : 0,
      end_reason: endReason,
    },
    players: playerStats,
  };

  const { error: endErr } = await sb.rpc("end_match", {
    p_room_id: room_id,
    p_reason: endReason,
  });
  if (endErr) return apiError("DB_UNAVAILABLE", dbMessage(endErr));

  const { error: sumErr } = await sb
    .from("match_results")
    .update({ summary_json: summary })
    .eq("room_id", room_id);
  if (sumErr) return apiError("DB_UNAVAILABLE", dbMessage(sumErr));

  const { data: after } = await sb
    .from("game_rooms")
    .select("status, ended_at")
    .eq("id", room_id)
    .single();

  const { data: match } = await sb
    .from("match_results")
    .select("id")
    .eq("room_id", room_id)
    .maybeSingle();

  const matchId = match?.id ?? null;
  await broadcastAction(room.room_code, {
    action: "MATCH_ENDED",
    actor_player_id: requester_player_id,
    data: { end_reason: endReason, match_id: matchId, summary },
  });
  await broadcastLobby(room.room_code);

  return apiOk({
    status: after?.status ?? "ENDED",
    ended_at: after?.ended_at ?? new Date().toISOString(),
    end_reason: endReason,
    match_id: matchId,
    summary,
  });
}

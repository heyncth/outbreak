import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  dbMessage,
  isValidUuid,
  rateLimit,
  requireJoinToken,
} from "@/lib/api";
import { broadcastAction, broadcastLobby } from "@/lib/broadcast";
import { serverClient } from "@/lib/supabase";
import { buildMatchSummary } from "@/lib/summary";
import type { EndReason, MatchPlayerStat } from "@/types/game";

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
    join_token,
    reason,
    knockdowns,
    auto_respawns,
    pathfinding_mode,
  } = (body ?? {}) as Record<string, unknown>;
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

  if (!(await requireJoinToken(sb, room_id, requester_player_id, join_token))) {
    return apiError("FORBIDDEN", "Invalid join token");
  }

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status, host_player_id, room_code, started_at")
    .eq("id", room_id)
    .maybeSingle();

  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");

  const isHost = room.host_player_id === requester_player_id;
  if (endReason === "HOST_ENDED" && !isHost) {
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
  const connected = rows.filter((p) => p.state !== "DISCONNECTED");
  if (
    endReason === "ALL_KNOCKED" &&
    !isHost &&
    !(connected.length > 0 && connected.every((p) => p.state === "KNOCKED"))
  ) {
    return apiError("FORBIDDEN", "Not all players are knocked");
  }

  const playerStats: MatchPlayerStat[] = rows.map((p) => ({
    player_id: p.player_id,
    nickname: p.nickname,
    distance_m: Number(p.distance_m) || 0,
    max_speed_ms: Number(p.max_speed_ms) || 0,
    rescues_count: Number(p.rescues_count) || 0,
    max_hp: Number(p.max_hp) || 100,
    state: p.state as MatchPlayerStat["state"],
  }));

  // knock counts come from host worker — only the real host may supply them
  const summary = buildMatchSummary(
    { started_at: room.started_at },
    playerStats,
    {
      knockdowns: isHost && typeof knockdowns === "number" ? knockdowns : 0,
      autoRespawns: isHost && typeof auto_respawns === "number" ? auto_respawns : 0,
      pathfinding_mode: typeof pathfinding_mode === "string" ? pathfinding_mode : undefined,
    },
    endReason
  );

  const { error: endErr } = await sb.rpc("end_match", {
    p_room_id: room_id,
    p_reason: endReason,
    p_summary: summary,
  });
  if (endErr) return apiError("DB_UNAVAILABLE", dbMessage(endErr));

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

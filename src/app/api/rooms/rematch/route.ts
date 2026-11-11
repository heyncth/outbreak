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

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { room_id, requester_player_id, join_token } = (body ?? {}) as Record<string, unknown>;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(requester_player_id)) {
    return apiError("VALIDATION_ERROR", "Invalid requester_player_id");
  }
  if (!rateLimit(`rematch:${requester_player_id}`, 5)) {
    return apiError("RATE_LIMITED", "Too many rematch attempts");
  }

  const sb = serverClient();
  if (!(await requireJoinToken(sb, room_id, requester_player_id, join_token))) {
    return apiError("FORBIDDEN", "Invalid join token");
  }

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status, room_code, host_player_id")
    .eq("id", room_id)
    .maybeSingle();

  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");
  if (room.host_player_id !== requester_player_id) {
    return apiError("NOT_HOST", "Only the host can rematch");
  }
  if (room.status !== "ENDED") {
    return apiError("ROOM_CONFLICT", "Room is not ENDED");
  }

  const { error: zonesErr } = await sb.from("safe_zones").delete().eq("room_id", room_id);
  if (zonesErr) return apiError("DB_UNAVAILABLE", dbMessage(zonesErr));

  const { error: playersErr } = await sb
    .from("room_players")
    .update({
      hp: 100,
      max_hp: 100,
      state: "ALIVE",
      noise_level: 0.05,
      distance_m: 0,
      max_speed_ms: 0,
      rescues_count: 0,
      knocked_at: null,
      disconnected_at: null,
    })
    .eq("room_id", room_id);
  if (playersErr) return apiError("DB_UNAVAILABLE", dbMessage(playersErr));

  const { error: roomErr2 } = await sb
    .from("game_rooms")
    .update({ status: "WAITING", started_at: null, ended_at: null })
    .eq("id", room_id);
  if (roomErr2) return apiError("DB_UNAVAILABLE", dbMessage(roomErr2));

  const { count } = await sb
    .from("room_players")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room_id);

  await sb
    .from("room_players")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("room_id", room_id)
    .eq("player_id", requester_player_id);

  await broadcastAction(room.room_code, {
    action: "REMATCH",
    actor_player_id: requester_player_id,
    data: { status: "WAITING" },
  });
  await broadcastLobby(room.room_code);

  return apiOk({
    status: "WAITING",
    room_code: room.room_code,
    reset_player_count: count ?? 0,
  });
}

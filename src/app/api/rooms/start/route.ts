import { NextRequest } from "next/server";
import { apiError, apiOk, dbMessage, isValidUuid, rateLimit, requireJoinToken } from "@/lib/api";
import { broadcastLobby } from "@/lib/broadcast";
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
  if (!rateLimit(`start:${requester_player_id}`, 10)) {
    return apiError("RATE_LIMITED", "Too many start attempts");
  }

  const sb = serverClient();

  if (!(await requireJoinToken(sb, room_id, requester_player_id, join_token))) {
    return apiError("FORBIDDEN", "Invalid join token");
  }

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status, host_player_id, center_lat, center_lng, room_code")
    .eq("id", room_id)
    .maybeSingle();

  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");
  if (room.host_player_id !== requester_player_id) {
    return apiError("NOT_HOST", "Only the host can start");
  }
  if (room.status !== "WAITING") {
    return apiError("ROOM_CONFLICT", "Room is not WAITING");
  }

  const startedAt = new Date().toISOString();
  const { data: updated, error: upErr } = await sb
    .from("game_rooms")
    .update({ status: "ACTIVE", started_at: startedAt, ended_at: null })
    .eq("id", room_id)
    .eq("status", "WAITING")
    .select("status, started_at, center_lat, center_lng")
    .single();

  if (upErr) return apiError("DB_UNAVAILABLE", dbMessage(upErr));
  if (!updated) return apiError("ROOM_CONFLICT", "Room is not WAITING");

  await broadcastLobby(room.room_code);

  return apiOk({
    status: updated.status,
    started_at: updated.started_at,
    center_lat: updated.center_lat,
    center_lng: updated.center_lng,
    pathfinding_mode: "GRAPH_ASTAR",
    zombie_density: "MEDIUM",
  });
}

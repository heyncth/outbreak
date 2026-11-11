import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  dbMessage,
  isValidUuid,
  rateLimit,
  requireJoinToken,
} from "@/lib/api";
import { serverClient } from "@/lib/supabase";
import { DISCONNECT_MS } from "@/engine/connectionGrace";

/** Mark players silent >10s DISCONNECTED; returns their ids for host worker sync. */
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
  if (!rateLimit(`sweep:${room_id}`, 30)) return apiError("RATE_LIMITED", "Sweep limited");

  const sb = serverClient();
  if (!(await requireJoinToken(sb, room_id, requester_player_id, join_token))) {
    return apiError("FORBIDDEN", "Invalid join token");
  }

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status, host_player_id")
    .eq("id", room_id)
    .maybeSingle();
  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");
  if (room.host_player_id !== requester_player_id) {
    return apiError("NOT_HOST", "Only the host can sweep");
  }
  if (room.status !== "ACTIVE") return apiOk({ disconnected: [] });

  const cutoff = new Date(Date.now() - DISCONNECT_MS).toISOString();
  const { data, error } = await sb
    .from("room_players")
    .update({ state: "DISCONNECTED", disconnected_at: new Date().toISOString() })
    .eq("room_id", room_id)
    .neq("state", "DISCONNECTED")
    .lt("last_seen_at", cutoff)
    .select("player_id");
  if (error) return apiError("DB_UNAVAILABLE", dbMessage(error));

  return apiOk({ disconnected: (data ?? []).map((p) => p.player_id) });
}

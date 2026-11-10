import { NextRequest } from "next/server";
import { apiError, apiOk, dbMessage, isValidUuid, rateLimit } from "@/lib/api";
import { broadcastAction } from "@/lib/broadcast";
import { serverClient } from "@/lib/supabase";

const STATES = new Set(["ALIVE", "KNOCKED", "DISCONNECTED"]);

/** Host-authoritative knock/respawn sync into room_players (rescue RPC reads DB state). */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { room_id, requester_player_id, target_player_id, state, max_hp, hp } = (body ??
    {}) as Record<string, unknown>;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(requester_player_id)) {
    return apiError("VALIDATION_ERROR", "Invalid requester_player_id");
  }
  if (!isValidUuid(target_player_id)) return apiError("VALIDATION_ERROR", "Invalid target_player_id");
  if (typeof state !== "string" || !STATES.has(state)) {
    return apiError("VALIDATION_ERROR", "Invalid state");
  }
  if (!rateLimit(`pstate:${requester_player_id}`, 60)) {
    return apiError("RATE_LIMITED", "Too many state updates");
  }

  const sb = serverClient();

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status, host_player_id, room_code")
    .eq("id", room_id)
    .maybeSingle();
  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");
  if (room.status !== "ACTIVE") return apiError("ROOM_CONFLICT", "Room is not ACTIVE");
  if (room.host_player_id !== requester_player_id) {
    return apiError("NOT_HOST", "Only the host can update player state");
  }

  const patch: Record<string, unknown> = { state };
  if (state === "KNOCKED") {
    patch.knocked_at = new Date().toISOString();
    patch.hp = 0;
  } else if (state === "ALIVE") {
    patch.knocked_at = null;
    if (typeof hp === "number" && Number.isFinite(hp) && hp >= 0) patch.hp = hp;
  }
  if (typeof max_hp === "number" && Number.isFinite(max_hp) && max_hp >= 20 && max_hp <= 100) {
    patch.max_hp = max_hp;
  }

  const { error: updErr } = await sb
    .from("room_players")
    .update(patch)
    .eq("room_id", room_id)
    .eq("player_id", target_player_id);
  if (updErr) return apiError("DB_UNAVAILABLE", dbMessage(updErr));

  await broadcastAction(room.room_code, {
    action: state === "KNOCKED" ? "AUTO_RESPAWN" : "RESCUE",
    actor_player_id: requester_player_id,
    data: { player_id: target_player_id, state },
  });

  return apiOk({ ok: true, state });
}

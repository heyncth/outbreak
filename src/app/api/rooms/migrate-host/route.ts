import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  dbMessage,
  isValidUuid,
  parseTs,
  rateLimit,
  requireJoinToken,
} from "@/lib/api";
import { broadcastAction, broadcastLobby } from "@/lib/broadcast";
import { serverClient } from "@/lib/supabase";
import { HOST_MIGRATE_MS } from "@/engine/connectionGrace";

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
  if (!rateLimit(`migrate:${requester_player_id}`, 5)) {
    return apiError("RATE_LIMITED", "Too many migrate attempts");
  }

  const sb = serverClient();
  if (!(await requireJoinToken(sb, room_id, requester_player_id, join_token))) {
    return apiError("FORBIDDEN", "Invalid join token");
  }

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status, host_player_id, room_code")
    .eq("id", room_id)
    .maybeSingle();
  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");
  if (room.status !== "ACTIVE") return apiError("ROOM_CONFLICT", "Room is not ACTIVE");
  if (room.host_player_id === requester_player_id) {
    return apiError("FORBIDDEN", "Already host");
  }

  const { data: requester, error: reqErr } = await sb
    .from("room_players")
    .select("id, state, joined_at")
    .eq("room_id", room_id)
    .eq("player_id", requester_player_id)
    .maybeSingle();
  if (reqErr) return apiError("DB_UNAVAILABLE", dbMessage(reqErr));
  if (!requester || requester.state !== "ALIVE") {
    return apiError("FORBIDDEN", "Requester must be ALIVE in room");
  }

  const { data: host, error: hostErr } = await sb
    .from("room_players")
    .select("state, last_seen_at")
    .eq("room_id", room_id)
    .eq("player_id", room.host_player_id)
    .maybeSingle();
  if (hostErr) return apiError("DB_UNAVAILABLE", dbMessage(hostErr));

  const hostLastSeen = parseTs(host?.last_seen_at) ?? 0;
  const hostSilent = !host || Date.now() - hostLastSeen > HOST_MIGRATE_MS;
  const hostDisconnected = !host || host.state === "DISCONNECTED";
  if (!hostSilent && !hostDisconnected) {
    return apiError("FORBIDDEN", "Host still active");
  }

  const { data: candidates, error: candErr } = await sb
    .from("room_players")
    .select("player_id, state, joined_at, last_seen_at")
    .eq("room_id", room_id)
    .neq("player_id", room.host_player_id)
    .order("joined_at", { ascending: true });
  if (candErr) return apiError("DB_UNAVAILABLE", dbMessage(candErr));

  const now = Date.now();
  const pick = (candidates ?? []).find((c) => {
    if (c.state !== "ALIVE") return false;
    const seen = parseTs(c.last_seen_at) ?? 0;
    return now - seen <= HOST_MIGRATE_MS || c.player_id === requester_player_id;
  });
  if (!pick) return apiError("FORBIDDEN", "No eligible host candidate");

  // optimistic lock: only promote if host has not changed since read
  const { data: upd, error: updErr } = await sb
    .from("game_rooms")
    .update({ host_player_id: pick.player_id })
    .eq("id", room_id)
    .eq("host_player_id", room.host_player_id)
    .select("id");
  if (updErr) return apiError("DB_UNAVAILABLE", dbMessage(updErr));
  if (!upd || upd.length === 0) {
    return apiError("ROOM_CONFLICT", "Host changed — retry migration");
  }

  await sb
    .from("room_players")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("room_id", room_id)
    .eq("player_id", pick.player_id);

  await broadcastAction(room.room_code, {
    action: "HOST_MIGRATED",
    actor_player_id: pick.player_id,
    data: { new_host_player_id: pick.player_id },
  });
  await broadcastLobby(room.room_code);

  return apiOk({ host_player_id: pick.player_id });
}

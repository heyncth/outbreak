import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  clientIp,
  dbMessage,
  isValidCoords,
  isValidNickname,
  isValidRoomCode,
  isValidUuid,
  rateLimit,
} from "@/lib/api";
import { broadcastLobby } from "@/lib/broadcast";
import { serverClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { room_code, nickname, player_id, lat, lng, join_token } = (body ?? {}) as Record<string, unknown>;

  if (!isValidRoomCode(room_code)) return apiError("INVALID_ROOM_CODE", "Room code: 6 chars A–Z 2–9");
  if (!isValidUuid(player_id)) return apiError("VALIDATION_ERROR", "Invalid player_id");
  if (!isValidNickname(nickname)) return apiError("INVALID_NICKNAME", "Nickname must be 2–30 chars");
  if (!isValidCoords(lat, lng)) return apiError("INVALID_COORDS", "Invalid lat/lng");
  if (!rateLimit(`join:${clientIp(req)}:${player_id}`, 20)) return apiError("RATE_LIMITED", "Too many join attempts");

  const sb = serverClient();

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, host_player_id, status")
    .eq("room_code", room_code)
    .maybeSingle();

  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");

  const { data: existing, error: exErr } = await sb
    .from("room_players")
    .select("id, join_token")
    .eq("room_id", room.id)
    .eq("player_id", player_id)
    .maybeSingle();

  if (exErr) return apiError("DB_UNAVAILABLE", dbMessage(exErr));

  const rejoined = Boolean(existing);
  if (rejoined) {
    // rejoin must prove identity — otherwise anyone holding only the room
    // code could steal the token (host takeover) or keep a ghost alive
    const tok = typeof join_token === "string" ? join_token : "";
    if (!isValidUuid(tok) || tok !== existing?.join_token) {
      return apiError("FORBIDDEN", "Invalid session — rejoin needs stored join token");
    }
  }

  if (!rejoined && room.status !== "WAITING") {
    return apiError("MATCH_ALREADY_STARTED", "Match already started");
  }

  const { data: rpc, error: joinErr } = await sb.rpc("join_room", {
    p_room_code: room_code,
    p_player_id: player_id,
    p_nickname: String(nickname).trim(),
    p_lat: lat,
    p_lng: lng,
  });

  if (joinErr) {
    const msg = dbMessage(joinErr);
    if (msg.includes("ROOM_FULL")) {
      return apiError("ROOM_FULL", "Room is full (max 10 players).", { limit: 10 });
    }
    if (msg.includes("MATCH_ALREADY_STARTED")) {
      return apiError("MATCH_ALREADY_STARTED", "Match already started");
    }
    if (msg.includes("ROOM_NOT_FOUND")) {
      return apiError("ROOM_NOT_FOUND", "Room not found");
    }
    return apiError("DB_UNAVAILABLE", msg);
  }

  const isHost = room.host_player_id === player_id;
  const status = (rpc as { status?: string }[] | null)?.[0]?.status ?? room.status;

  await sb
    .from("room_players")
    .update({ last_seen_at: new Date().toISOString(), disconnected_at: null })
    .eq("room_id", room.id)
    .eq("player_id", player_id);

  await broadcastLobby(room_code);

  const { data: tok, error: tokErr } = await sb
    .from("room_players")
    .select("join_token")
    .eq("room_id", room.id)
    .eq("player_id", player_id)
    .maybeSingle();
  if (tokErr) return apiError("DB_UNAVAILABLE", dbMessage(tokErr));

  return apiOk({
    room_id: room.id,
    player_id,
    is_host: isHost,
    status,
    rejoined,
    join_token: tok?.join_token ?? null,
  });
}

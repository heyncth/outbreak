import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  dbMessage,
  isValidCoords,
  isValidNickname,
  isValidUuid,
  rateLimit,
} from "@/lib/api";
import { broadcastLobby } from "@/lib/broadcast";
import { serverClient } from "@/lib/supabase";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { nickname, player_id, lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (!isValidUuid(player_id)) return apiError("VALIDATION_ERROR", "Invalid player_id");
  if (!isValidNickname(nickname)) return apiError("INVALID_NICKNAME", "Nickname must be 2–30 chars");
  if (!isValidCoords(lat, lng)) return apiError("INVALID_COORDS", "Invalid lat/lng");
  if (!rateLimit(`create:${player_id}`, 10)) return apiError("RATE_LIMITED", "Too many room creates");

  const sb = serverClient();

  for (let attempt = 0; attempt < 5; attempt++) {
    const room_code = makeCode();
    const { data: room, error: roomErr } = await sb
      .from("game_rooms")
      .insert({
        room_code,
        host_player_id: player_id,
        status: "WAITING",
        center_lat: lat,
        center_lng: lng,
      })
      .select("id, room_code, status")
      .single();

    if (roomErr) {
      if (roomErr.code === "23505") continue;
      return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
    }

    const { error: joinErr } = await sb.rpc("join_room", {
      p_room_code: room_code,
      p_player_id: player_id,
      p_nickname: String(nickname).trim(),
      p_lat: lat,
      p_lng: lng,
    });

    if (joinErr) {
      await sb.from("game_rooms").delete().eq("id", room.id);
      return apiError("DB_UNAVAILABLE", dbMessage(joinErr));
    }

    // join_room inserts DEFAULT NOW() (PG clock); overwrite with app clock
    // so age checks against Date.now() are not skewed
    await sb
      .from("room_players")
      .update({ last_seen_at: new Date().toISOString(), disconnected_at: null })
      .eq("room_id", room.id)
      .eq("player_id", player_id);

    await broadcastLobby(room_code);

    return apiOk(
      {
        room_id: room.id,
        room_code: room.room_code,
        player_id,
        is_host: true,
        status: "WAITING",
      },
      201
    );
  }

  return apiError("INTERNAL_ERROR", "Could not allocate room code");
}

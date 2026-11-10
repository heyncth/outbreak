import { NextRequest, NextResponse } from "next/server";
import { apiError, dbMessage, isValidRoomCode, rateLimit } from "@/lib/api";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } }
) {
  const code = params.code?.toUpperCase();
  if (!isValidRoomCode(code)) return apiError("INVALID_ROOM_CODE", "Room code: 6 chars A–Z 2–9");
  if (!rateLimit(`get:${code}`, 60)) return apiError("RATE_LIMITED", "Too many requests");

  const sb = serverClient();

  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select(
      "id, room_code, status, host_player_id, center_lat, center_lng"
    )
    .eq("room_code", code)
    .maybeSingle();

  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");

  const { data: players, error: pErr } = await sb
    .from("room_players")
    .select("player_id, nickname, state, hp, max_hp, distance_m, max_speed_ms")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: true });

  if (pErr) return apiError("DB_UNAVAILABLE", dbMessage(pErr));

  const rows = players ?? [];
  const active = rows.filter((p) => p.state !== "DISCONNECTED");

  return NextResponse.json(
    {
      room_id: room.id,
      room_code: room.room_code,
      status: room.status,
      host_player_id: room.host_player_id,
      center_lat: room.center_lat,
      center_lng: room.center_lng,
      player_count: active.length,
      players: rows.map((p) => ({
        player_id: p.player_id,
        nickname: p.nickname,
        state: p.state,
        hp: p.hp,
        max_hp: p.max_hp,
        distance_m: p.distance_m,
        max_speed_ms: p.max_speed_ms,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

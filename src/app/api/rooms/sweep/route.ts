import { NextRequest } from "next/server";
import { apiError, apiOk, dbMessage, isValidUuid, parseTs, rateLimit } from "@/lib/api";
import { serverClient } from "@/lib/supabase";
import { DISCONNECT_MS, GRACE_MS } from "@/engine/connectionGrace";

/** Mark players silent >10s DISCONNECTED; expire grace >90s for end-condition. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { room_id, requester_player_id } = (body ?? {}) as Record<string, unknown>;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(requester_player_id)) {
    return apiError("VALIDATION_ERROR", "Invalid requester_player_id");
  }
  if (!rateLimit(`sweep:${room_id}`, 30)) return apiError("RATE_LIMITED", "Sweep limited");

  const sb = serverClient();
  const { data: room, error: roomErr } = await sb
    .from("game_rooms")
    .select("id, status")
    .eq("id", room_id)
    .maybeSingle();
  if (roomErr) return apiError("DB_UNAVAILABLE", dbMessage(roomErr));
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found");
  if (room.status !== "ACTIVE") return apiOk({ marked: 0, expired: 0 });

  const now = Date.now();
  const { data: players, error: pErr } = await sb
    .from("room_players")
    .select("id, player_id, state, last_seen_at, joined_at")
    .eq("room_id", room_id);
  if (pErr) return apiError("DB_UNAVAILABLE", dbMessage(pErr));

  let marked = 0;
  let expired = 0;

  for (const p of players ?? []) {
    if (p.state === "DISCONNECTED") continue;
    const last = parseTs(p.last_seen_at) ?? now;
    const silence = now - last;
    if (silence > DISCONNECT_MS && silence <= DISCONNECT_MS + GRACE_MS) {
      const { error } = await sb
        .from("room_players")
        .update({
          state: "DISCONNECTED",
          disconnected_at: new Date(last + DISCONNECT_MS).toISOString(),
        })
        .eq("id", p.id)
        .eq("state", p.state);
      if (!error) marked += 1;
    }
  }

  const { data: discs, error: dErr } = await sb
    .from("room_players")
    .select("id, disconnected_at")
    .eq("room_id", room_id)
    .eq("state", "DISCONNECTED");
  if (dErr) return apiError("DB_UNAVAILABLE", dbMessage(dErr));

  for (const p of discs ?? []) {
    const discAt = parseTs(p.disconnected_at) ?? 0;
    if (discAt && now - discAt > GRACE_MS) {
      expired += 1;
    }
  }

  return apiOk({ marked, expired });
}

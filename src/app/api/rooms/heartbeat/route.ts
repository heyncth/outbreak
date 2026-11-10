import { NextRequest } from "next/server";
import { apiError, apiOk, dbMessage, isValidUuid, rateLimit } from "@/lib/api";
import { serverClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { room_id, player_id, distance_m, max_speed_ms } = (body ?? {}) as Record<string, unknown>;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(player_id)) return apiError("VALIDATION_ERROR", "Invalid player_id");
  if (!rateLimit(`hb:${player_id}`, 30)) return apiError("RATE_LIMITED", "Heartbeat limited");

  const sb = serverClient();
  const patch: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
    disconnected_at: null,
  };
  if (typeof distance_m === "number" && Number.isFinite(distance_m) && distance_m >= 0) {
    patch.distance_m = distance_m;
  }
  if (typeof max_speed_ms === "number" && Number.isFinite(max_speed_ms) && max_speed_ms >= 0) {
    patch.max_speed_ms = max_speed_ms;
  }

  const { data, error } = await sb
    .from("room_players")
    .update(patch)
    .eq("room_id", room_id)
    .eq("player_id", player_id)
    .select("id")
    .maybeSingle();

  if (error) return apiError("DB_UNAVAILABLE", dbMessage(error));
  if (!data) return apiError("PLAYER_NOT_FOUND", "Player not in room");
  return apiOk({ ok: true });
}

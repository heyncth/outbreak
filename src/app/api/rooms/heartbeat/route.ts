import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  dbMessage,
  isValidCoords,
  isValidUuid,
  rateLimit,
  requireJoinToken,
} from "@/lib/api";
import { serverClient } from "@/lib/supabase";

// heartbeat cadence 5s — max realistic growth per report with slack
const MAX_DIST_DELTA_M = 100;
const MAX_SPEED_MPS = 12;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { room_id, player_id, join_token, distance_m, max_speed_ms, lat, lng } = (body ??
    {}) as Record<string, unknown>;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(player_id)) return apiError("VALIDATION_ERROR", "Invalid player_id");
  if (!rateLimit(`hb:${player_id}`, 30)) return apiError("RATE_LIMITED", "Heartbeat limited");

  const sb = serverClient();
  if (!(await requireJoinToken(sb, room_id, player_id, join_token))) {
    return apiError("FORBIDDEN", "Invalid join token");
  }

  const patch: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
    disconnected_at: null,
  };
  if (isValidCoords(lat, lng)) {
    // own-row location only — rescue distance check reads this
    patch.location = `POINT(${lng} ${lat})`;
  }

  const { data, error } = await sb
    .from("room_players")
    .update(patch)
    .eq("room_id", room_id)
    .eq("player_id", player_id)
    .select("id, distance_m, max_speed_ms")
    .maybeSingle();

  if (error) return apiError("DB_UNAVAILABLE", dbMessage(error));
  if (!data) return apiError("PLAYER_NOT_FOUND", "Player not in room");

  const wantsStats =
    typeof distance_m === "number" &&
    Number.isFinite(distance_m) &&
    distance_m >= 0 &&
    typeof max_speed_ms === "number" &&
    Number.isFinite(max_speed_ms) &&
    max_speed_ms >= 0;
  if (wantsStats) {
    // client-supplied stats: monotonic, bounded growth per report
    const oldDist = data.distance_m ?? 0;
    const clampedDist = Math.min(
      Math.max(oldDist, distance_m as number),
      oldDist + MAX_DIST_DELTA_M
    );
    const clampedSpeed = Math.min(max_speed_ms as number, MAX_SPEED_MPS);
    const { error: statErr } = await sb
      .from("room_players")
      .update({ distance_m: clampedDist, max_speed_ms: clampedSpeed })
      .eq("room_id", room_id)
      .eq("player_id", player_id);
    if (statErr) return apiError("DB_UNAVAILABLE", dbMessage(statErr));
  }

  return apiOk({ ok: true });
}

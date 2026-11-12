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

const RESCUE_HOLD_MS = 3000;
const HOLD_STALE_MS = 15000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const {
    room_id,
    rescuer_id,
    victim_id,
    join_token,
    rescuer_lat,
    rescuer_lng,
    hold_elapsed_ms,
  } = (body ?? {}) as Record<string, unknown>;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(rescuer_id)) return apiError("VALIDATION_ERROR", "Invalid rescuer_id");
  if (!isValidUuid(victim_id)) return apiError("VALIDATION_ERROR", "Invalid victim_id");
  if (!rateLimit(`rescue:${rescuer_id}`, 5)) return apiError("RATE_LIMITED", "Too many rescue attempts");

  // 3s hold enforced server-side (client HUD hold is UI, this is truth)
  if (typeof hold_elapsed_ms !== "number" || !Number.isFinite(hold_elapsed_ms)) {
    return apiError("VALIDATION_ERROR", "hold_elapsed_ms required");
  }
  if (hold_elapsed_ms < RESCUE_HOLD_MS || hold_elapsed_ms > HOLD_STALE_MS) {
    return apiError("VALIDATION_ERROR", "Rescue hold not completed");
  }

  const sb = serverClient();
  if (!(await requireJoinToken(sb, room_id, rescuer_id, join_token))) {
    return apiError("FORBIDDEN", "Invalid join token");
  }

  // rescuer reports OWN position only — victim position comes from the
  // victim's own heartbeat (token-bound), never from this request
  if (isValidCoords(rescuer_lat, rescuer_lng)) {
    const { error: locErr } = await sb
      .from("room_players")
      .update({
        location: `POINT(${rescuer_lng} ${rescuer_lat})`,
        updated_at: new Date().toISOString(),
      })
      .eq("room_id", room_id)
      .eq("player_id", rescuer_id);
    if (locErr) return apiError("DB_UNAVAILABLE", dbMessage(locErr));
  }

  const { data, error } = await sb.rpc("attempt_rescue", {
    p_rescuer_id: rescuer_id,
    p_victim_id: victim_id,
  });

  if (error) {
    const msg = dbMessage(error);
    if (msg.includes("not found") || msg.includes("PLAYER")) {
      return apiError("PLAYER_NOT_FOUND", "Player not found");
    }
    return apiError("DB_UNAVAILABLE", msg);
  }

  if (data === true) {
    const { data: victim } = await sb
      .from("room_players")
      .select("hp, state")
      .eq("room_id", room_id)
      .eq("player_id", victim_id)
      .maybeSingle();
    return apiOk({
      rescued: true,
      victim_hp: victim?.hp ?? 50,
      victim_state: victim?.state ?? "ALIVE",
    });
  }

  return apiOk({ rescued: false, reason: "TOO_FAR_OR_INVALID" });
}

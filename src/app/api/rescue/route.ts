import { NextRequest } from "next/server";
import { apiError, apiOk, dbMessage, isValidUuid, rateLimit } from "@/lib/api";
import { serverClient } from "@/lib/supabase";

function isValidLatLng(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { rescuer_id, victim_id, rescuer_lat, rescuer_lng, victim_lat, victim_lng } = (
    body ?? {}
  ) as Record<string, unknown>;
  if (!isValidUuid(rescuer_id)) return apiError("VALIDATION_ERROR", "Invalid rescuer_id");
  if (!isValidUuid(victim_id)) return apiError("VALIDATION_ERROR", "Invalid victim_id");
  if (!rateLimit(`rescue:${rescuer_id}`, 5)) return apiError("RATE_LIMITED", "Too many rescue attempts");

  const sb = serverClient();

  // refresh locations from live tick coords so RPC distance check is real
  if (
    isValidLatLng(rescuer_lat) &&
    isValidLatLng(rescuer_lng) &&
    isValidLatLng(victim_lat) &&
    isValidLatLng(victim_lng)
  ) {
    const { error: locErr } = await sb.rpc("touch_rescue_locations", {
      p_rescuer_id: rescuer_id,
      p_rescuer_lat: rescuer_lat,
      p_rescuer_lng: rescuer_lng,
      p_victim_id: victim_id,
      p_victim_lat: victim_lat,
      p_victim_lng: victim_lng,
    });
    if (locErr) {
      // fallback: direct updates if RPC missing
      await sb
        .from("room_players")
        .update({
          location: `POINT(${rescuer_lng} ${rescuer_lat})`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rescuer_id);
      await sb
        .from("room_players")
        .update({
          location: `POINT(${victim_lng} ${victim_lat})`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", victim_id);
    }
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
      .eq("id", victim_id)
      .maybeSingle();
    return apiOk({
      rescued: true,
      victim_hp: victim?.hp ?? 50,
      victim_state: victim?.state ?? "ALIVE",
    });
  }

  return apiOk({ rescued: false, reason: "TOO_FAR_OR_INVALID" });
}

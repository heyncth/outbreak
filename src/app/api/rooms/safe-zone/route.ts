import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  dbMessage,
  isValidCoords,
  isValidUuid,
  rateLimit,
  parseTs,
  requireJoinToken,
} from "@/lib/api";
import { broadcastAction } from "@/lib/broadcast";
import { serverClient } from "@/lib/supabase";
import { ZONE_COOLDOWN_MS, ZONE_RADIUS_M, ZONE_TTL_SEC } from "@/engine/survivalRules";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body");
  }
  const { room_id, requester_player_id, join_token, lat, lng } = (body ?? {}) as Record<string, unknown>;
  if (!isValidUuid(room_id)) return apiError("VALIDATION_ERROR", "Invalid room_id");
  if (!isValidUuid(requester_player_id)) {
    return apiError("VALIDATION_ERROR", "Invalid requester_player_id");
  }
  if (!isValidCoords(lat, lng)) return apiError("INVALID_COORDS", "Invalid zone coordinates");

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
  if (room.host_player_id !== requester_player_id) {
    return apiError("NOT_HOST", "Only the host can create safe zones");
  }
  if (room.status !== "ACTIVE") return apiError("ROOM_CONFLICT", "Room is not ACTIVE");

  const { data: last, error: lastErr } = await sb
    .from("safe_zones")
    .select("created_at")
    .eq("room_id", room_id)
    .eq("zone_type", "HOST_CREATED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) return apiError("DB_UNAVAILABLE", dbMessage(lastErr));
  const lastMs = last ? parseTs(last.created_at) : null;
  const now = Date.now();
  if (lastMs != null && now - lastMs < ZONE_COOLDOWN_MS) {
    const waitSec = Math.ceil((ZONE_COOLDOWN_MS - (now - lastMs)) / 1000);
    return apiError("RATE_LIMITED", "Safe zone cooldown active", { wait_sec: waitSec });
  }
  // rate limit only after DB cooldown passes (so failed inserts don't burn budget)
  if (!rateLimit(`safe-zone:${requester_player_id}`, 1, ZONE_COOLDOWN_MS)) {
    return apiError("RATE_LIMITED", "Safe zone cooldown active");
  }

  const expiresAt = new Date(now + ZONE_TTL_SEC * 1000).toISOString();
  const { data: zoneRows, error: insErr } = await sb.rpc("create_host_zone", {
    p_room_id: room_id,
    p_lat: lat as number,
    p_lng: lng as number,
    p_radius_m: ZONE_RADIUS_M,
    p_ttl_sec: ZONE_TTL_SEC,
  });
  if (insErr) return apiError("DB_UNAVAILABLE", dbMessage(insErr));
  const zoneRow = Array.isArray(zoneRows) ? zoneRows[0] : zoneRows;
  const zoneId = (zoneRow?.zone_id ?? zoneRow?.id) as string | undefined;
  if (!zoneId) return apiError("DB_UNAVAILABLE", "Zone insert returned no id");
  const zoneExpires =
    (zoneRow?.zone_expires_at as string | undefined) ??
    (zoneRow?.expires_at as string | undefined) ??
    expiresAt;
  await broadcastAction(room.room_code, {
    action: "SPAWN_SAFE_ZONE",
    actor_player_id: requester_player_id,
    data: {
      id: zoneId,
      zone_type: "HOST_CREATED",
      lat: lat as number,
      lng: lng as number,
      radius_m: ZONE_RADIUS_M,
      expires_in_sec: ZONE_TTL_SEC,
      expires_at: zoneExpires,
    },
  });

  return apiOk(
    {
      zone_id: zoneId,
      zone_type: "HOST_CREATED",
      radius_m: ZONE_RADIUS_M,
      expires_at: zoneExpires,
      cooldown_until: new Date(now + ZONE_COOLDOWN_MS).toISOString(),
    },
    201
  );
}

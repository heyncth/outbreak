import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ErrorCode =
  | "INVALID_NICKNAME"
  | "INVALID_ROOM_CODE"
  | "INVALID_COORDS"
  | "VALIDATION_ERROR"
  | "MATCH_ALREADY_STARTED"
  | "NOT_HOST"
  | "FORBIDDEN"
  | "ROOM_NOT_FOUND"
  | "MATCH_NOT_FOUND"
  | "PLAYER_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "DB_UNAVAILABLE";

const STATUS: Record<ErrorCode, number> = {
  INVALID_NICKNAME: 400,
  INVALID_ROOM_CODE: 400,
  INVALID_COORDS: 400,
  VALIDATION_ERROR: 400,
  MATCH_ALREADY_STARTED: 403,
  NOT_HOST: 403,
  FORBIDDEN: 403,
  ROOM_NOT_FOUND: 404,
  MATCH_NOT_FOUND: 404,
  PLAYER_NOT_FOUND: 404,
  ROOM_FULL: 409,
  ROOM_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  DB_UNAVAILABLE: 503,
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function apiError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS[code], headers: NO_STORE }
  );
}

export function apiOk<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const hits = new Map<string, { n: number; reset: number }>();

/** Client IP for rate-limit keys; x-forwarded-for first hop (Vercel sets it). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? (fwd.split(",")[0] ?? "").trim().slice(0, 45) || "na" : "na";
}

export function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (hits.size > 1000) {
    for (const [k, v] of hits) {
      if (now > v.reset) hits.delete(k);
    }
  }
  const row = hits.get(key);
  if (row && now > row.reset) hits.delete(key);
  if (!row || now > row.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (row.n >= limit) return false;
  row.n += 1;
  return true;
}

/** Prove requester owns (room_id, player_id) via per-join secret. Fail closed. */
export async function requireJoinToken(
  sb: SupabaseClient,
  roomId: string,
  playerId: string,
  token: unknown
): Promise<boolean> {
  if (!isValidUuid(roomId) || !isValidUuid(playerId)) return false;
  if (typeof token !== "string" || !isValidUuid(token)) return false;
  const { data, error } = await sb
    .from("room_players")
    .select("join_token")
    .eq("room_id", roomId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (error || !data) return false;
  return data.join_token === token;
}

export function isValidUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export function isValidNickname(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 30;
}

export function isValidCoords(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function isValidRoomCode(v: unknown): v is string {
  return typeof v === "string" && /^[A-Z2-9]{6}$/.test(v);
}

export function dbMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; code?: string; details?: unknown };
    return o.message ?? JSON.stringify(e);
  }
  return String(e);
}

/** Parse Postgres / ISO timestamps; null if unparseable. */
export function parseTs(v: string | null | undefined): number | null {
  if (!v) return null;
  let iso = v.includes("T") ? v : v.replace(" ", "T");
  // Postgres may emit +00 without :00 — JS Date.parse rejects that
  iso = iso.replace(/([+-]\d{2})$/, "$1:00");
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

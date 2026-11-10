import { NextRequest, NextResponse } from "next/server";
import { apiError, dbMessage, isValidUuid, rateLimit } from "@/lib/api";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const roomId = params.roomId;
  if (!isValidUuid(roomId)) return apiError("VALIDATION_ERROR", "Invalid roomId");
  if (!rateLimit(`match:${roomId}`, 30)) return apiError("RATE_LIMITED", "Too many requests");

  const sb = serverClient();

  const { data, error } = await sb
    .from("match_results")
    .select("room_id, duration_sec, end_reason, summary_json, created_at")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) return apiError("DB_UNAVAILABLE", dbMessage(error));
  if (!data) return apiError("MATCH_NOT_FOUND", "Match not found");

  return NextResponse.json(
    {
      room_id: data.room_id,
      duration_sec: data.duration_sec,
      end_reason: data.end_reason,
      summary_json: data.summary_json,
      created_at: data.created_at,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

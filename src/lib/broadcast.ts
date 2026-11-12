import type { RealtimeChannel } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase";

// one channel per room; evicted after 30 min idle so the map can't leak
const CHANNEL_TTL_MS = 30 * 60_000;
const channels = new Map<string, { p: Promise<RealtimeChannel>; used: number }>();

function evictIdle(now: number): void {
  for (const [code, e] of channels) {
    if (now - e.used > CHANNEL_TTL_MS) {
      channels.delete(code);
      void e.p.then((ch) => ch.unsubscribe()).catch(() => {});
    }
  }
}

function getChannel(roomCode: string): Promise<RealtimeChannel> {
  const now = Date.now();
  evictIdle(now);
  let e = channels.get(roomCode);
  if (!e) {
    const ch = serverClient().channel(`room:${roomCode}`);
    const p = new Promise<RealtimeChannel>((resolve) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          resolve(ch);
        }
      });
    });
    e = { p, used: now };
    channels.set(roomCode, e);
  }
  e.used = now;
  return e.p;
}

export async function broadcastLobby(roomCode: string): Promise<void> {
  try {
    const ch = await getChannel(roomCode);
    await ch.send({
      type: "broadcast",
      event: "lobby_state",
      payload: { at: Date.now() },
    });
  } catch {
    /* clients keep slow poll as fallback */
  }
}

export async function broadcastAction(
  roomCode: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const ch = await getChannel(roomCode);
    await ch.send({
      type: "broadcast",
      event: "game_action",
      payload,
    });
  } catch {
    /* best-effort */
  }
}

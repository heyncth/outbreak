import type { RealtimeChannel } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase";

// one channel per room for process lifetime — subscribe once, keep open
const channels = new Map<string, Promise<RealtimeChannel>>();

function getChannel(roomCode: string): Promise<RealtimeChannel> {
  let p = channels.get(roomCode);
  if (!p) {
    const ch = serverClient().channel(`room:${roomCode}`);
    p = new Promise((resolve) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          resolve(ch);
        }
      });
    });
    channels.set(roomCode, p);
  }
  return p;
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

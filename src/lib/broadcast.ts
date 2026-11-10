import { serverClient } from "@/lib/supabase";

export async function broadcastLobby(roomCode: string): Promise<void> {
  try {
    const sb = serverClient();
    const ch = sb.channel(`room:${roomCode}`);
    await ch.subscribe();
    await ch.send({
      type: "broadcast",
      event: "lobby_state",
      payload: { at: Date.now() },
    });
    await sb.removeChannel(ch);
  } catch {
    /* clients keep slow poll as fallback */
  }
}

export async function broadcastAction(
  roomCode: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const sb = serverClient();
    const ch = sb.channel(`room:${roomCode}`);
    await ch.subscribe();
    await ch.send({
      type: "broadcast",
      event: "game_action",
      payload,
    });
    await sb.removeChannel(ch);
  } catch {
    /* best-effort */
  }
}

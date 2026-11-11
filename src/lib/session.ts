export interface PlayerSession {
  playerId: string;
  nickname: string;
  joinToken: string | null;
}

const KEY = "outbreak_player_session";

interface StoredSession {
  player_id?: string;
  playerId?: string;
  nickname?: string;
  join_token?: string;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** Read (or create) local session. Safe on server — returns fresh uuid. */
export function readSession(): PlayerSession {
  if (!hasWindow()) {
    return { playerId: crypto.randomUUID(), nickname: "", joinToken: null };
  }
  let raw = localStorage.getItem(KEY);
  if (!raw) {
    const s: PlayerSession = { playerId: crypto.randomUUID(), nickname: "", joinToken: null };
    writeSession(s);
    return s;
  }
  try {
    const p = JSON.parse(raw) as StoredSession;
    const playerId = p.player_id ?? p.playerId;
    if (!playerId) {
      const s: PlayerSession = { playerId: crypto.randomUUID(), nickname: "", joinToken: null };
      writeSession(s);
      return s;
    }
    return {
      playerId,
      nickname: p.nickname ?? "",
      joinToken: p.join_token ?? null,
    };
  } catch {
    return { playerId: crypto.randomUUID(), nickname: "", joinToken: null };
  }
}

export function writeSession(s: PlayerSession): void {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        player_id: s.playerId,
        nickname: s.nickname,
        join_token: s.joinToken ?? undefined,
      })
    );
  } catch {
    /* storage full/blocked — session stays in memory */
  }
}

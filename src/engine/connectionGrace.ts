export const DISCONNECT_MS = 10_000;
export const GRACE_MS = 90_000;
export const HOST_MIGRATE_MS = 15_000;

export type LivePlayerState = "ALIVE" | "KNOCKED";

export interface HeartbeatView {
  player_id: string;
  last_seen_ms: number;
  prior_state: LivePlayerState;
  joined_at_ms: number;
}

export type DerivedState =
  | { kind: "LIVE"; state: LivePlayerState }
  | { kind: "DISCONNECTED"; grace_remaining_ms: number }
  | { kind: "EXPIRED" };

export function derivePlayerState(
  p: HeartbeatView,
  nowMs: number
): DerivedState {
  const silence = nowMs - p.last_seen_ms;
  if (silence <= DISCONNECT_MS) {
    return { kind: "LIVE", state: p.prior_state };
  }
  const sinceDisconnect = silence - DISCONNECT_MS;
  if (sinceDisconnect < GRACE_MS) {
    return {
      kind: "DISCONNECTED",
      grace_remaining_ms: GRACE_MS - sinceDisconnect,
    };
  }
  return { kind: "EXPIRED" };
}

export function shouldRestore(
  prior: LivePlayerState,
  nowMs: number,
  disconnectedAtMs: number
): LivePlayerState | null {
  if (nowMs - disconnectedAtMs < GRACE_MS) return prior;
  return null;
}

export function shouldMigrateHost(
  hostLastSeenMs: number,
  nowMs: number
): boolean {
  return nowMs - hostLastSeenMs > HOST_MIGRATE_MS;
}

export interface RoomMember {
  player_id: string;
  joined_at_ms: number;
  state: LivePlayerState | "DISCONNECTED";
}

/** Earliest-joined remaining ALIVE player, excluding current host. */
export function nextHostId(
  members: RoomMember[],
  currentHostId: string,
  nowMs: number
): string | null {
  const eligible = members
    .filter(
      (m) =>
        m.player_id !== currentHostId &&
        m.state === "ALIVE" &&
        derivePlayerState(
          {
            player_id: m.player_id,
            last_seen_ms: nowMs,
            prior_state: "ALIVE",
            joined_at_ms: m.joined_at_ms,
          },
          nowMs
        ).kind === "LIVE"
    )
    .sort((a, b) => a.joined_at_ms - b.joined_at_ms);
  return eligible[0]?.player_id ?? null;
}

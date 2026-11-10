import type { WorldStateTick, SafeZoneTick } from "@/types/game";
import type { PlayerWorld, ZombieWorld } from "@/engine/roomTick.worker";

export interface RestoredWorld {
  players: PlayerWorld[];
  zombies: ZombieWorld[];
  zones: SafeZoneTick[];
  startedAt: number;
  tickId: number;
}

/** Seed worker state from last broadcast tick after host migration. Pure. */
export function restoreFromTick(tick: WorldStateTick, now = Date.now()): RestoredWorld {
  return {
    players: tick.players.map((p) => ({ ...p })),
    zombies: tick.zombies.map(
      (z): ZombieWorld => ({
        id: z.id,
        type: z.type,
        state: z.state,
        lat: z.lat,
        lng: z.lng,
        heading_deg: z.heading_deg,
        target_player_id: z.target_player_id,
        path: [],
        pathIndex: 0,
        goal: null,
        stateEnteredAt: now,
        lastPathAt: 0,
        needsPath: true,
      })
    ),
    zones: tick.safe_zones.map((z) => ({ ...z })),
    startedAt: now - tick.elapsed_sec * 1000,
    tickId: tick.tick_id,
  };
}

import type { LatLng, WorldStateTick } from "@/types/game";

const KEY = "outbreak_match_progress";
const MAX_TRACK = 400;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface MatchProgress {
  roomCode: string;
  roomId: string | null;
  distanceM: number;
  maxSpeedMs: number;
  knockdowns: number;
  gpsTrack: LatLng[];
  worldTick: WorldStateTick | null;
  savedAt: number;
}

export function saveMatchProgress(entry: Omit<MatchProgress, "savedAt" | "gpsTrack"> & {
  gpsTrack?: LatLng[];
}): void {
  try {
    const track = (entry.gpsTrack ?? []).slice(-MAX_TRACK);
    const payload: MatchProgress = {
      roomCode: entry.roomCode,
      roomId: entry.roomId,
      distanceM: entry.distanceM,
      maxSpeedMs: entry.maxSpeedMs,
      knockdowns: entry.knockdowns,
      gpsTrack: track,
      worldTick: entry.worldTick,
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* quota — drop worldTick and retry once */
    try {
      const { worldTick: _w, ...rest } = entry;
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...rest,
          gpsTrack: (entry.gpsTrack ?? []).slice(-100),
          worldTick: null,
          savedAt: Date.now(),
        } satisfies MatchProgress)
      );
    } catch {
      /* give up */
    }
  }
}

export function loadMatchProgress(roomCode?: string): MatchProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as MatchProgress;
    if (!v.roomCode) return null;
    if (roomCode && v.roomCode !== roomCode.toUpperCase()) return null;
    if (Date.now() - v.savedAt > MAX_AGE_MS) {
      clearMatchProgress();
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function clearMatchProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

"use client";

import { create } from "zustand";
import type { LatLng, MatchSummaryJson, PathfindingModeLike, WorldStateTick } from "@/types/game";
import { readSession, writeSession } from "@/lib/session";
import { haversineM } from "@/lib/geoUtils";

interface GameState {
  roomCode: string | null;
  roomId: string | null;
  playerId: string | null;
  nickname: string | null;
  joinToken: string | null;
  isHost: boolean;
  selfPos: LatLng | null;
  worldTick: WorldStateTick | null;
  pathfindingMode: PathfindingModeLike;
  graphNotice: string | null;
  gpsTrack: LatLng[];
  distanceM: number;
  maxSpeedMs: number;
  knockdowns: number;
  autoRespawns: number;
  matchSummary: MatchSummaryJson | null;
  matchEnded: boolean;
  setSession: (p: { playerId: string; nickname: string; joinToken?: string | null }) => void;
  setRoom: (p: { roomCode: string; isHost: boolean; roomId?: string | null }) => void;
  setSelfPos: (p: LatLng) => void;
  setWorldTick: (t: WorldStateTick | null) => void;
  setPathfinding: (mode: PathfindingModeLike, notice?: string | null) => void;
  recordGps: (p: LatLng, speedMs: number) => void;
  recordKnock: () => void;
  recordAutoRespawn: () => void;
  setMatchSummary: (s: MatchSummaryJson | null) => void;
  setMatchEnded: (v: boolean) => void;
  resetMatchStats: () => void;
  resetRoom: () => void;
}

const emptyStats = {
  gpsTrack: [] as LatLng[],
  distanceM: 0,
  maxSpeedMs: 0,
  knockdowns: 0,
  autoRespawns: 0,
  matchSummary: null as MatchSummaryJson | null,
  matchEnded: false,
};

export const useGameStore = create<GameState>((set) => ({
  roomCode: null,
  roomId: null,
  playerId: null,
  nickname: null,
  joinToken: null,
  isHost: false,
  selfPos: null,
  worldTick: null,
  pathfindingMode: "GRAPH_ASTAR",
  graphNotice: null,
  ...emptyStats,
  setSession: ({ playerId, nickname, joinToken }) =>
    set((s) => {
      const next = {
        playerId,
        nickname,
        joinToken: joinToken !== undefined ? joinToken : s.joinToken,
      };
      writeSession(next);
      return next;
    }),
  setRoom: ({ roomCode, isHost, roomId }) =>
    set((s) => ({
      roomCode,
      isHost,
      roomId: roomId !== undefined ? roomId : s.roomId,
    })),
  setSelfPos: (p) => set({ selfPos: p }),
  setWorldTick: (t) => set({ worldTick: t }),
  setPathfinding: (mode, notice = null) =>
    set({ pathfindingMode: mode, graphNotice: notice }),
  recordGps: (p, speedMs) =>
    set((s) => {
      const last = s.gpsTrack[s.gpsTrack.length - 1];
      const track =
        !last || Math.abs(p.lat - last.lat) + Math.abs(p.lng - last.lng) > 1e-6
          ? [...s.gpsTrack, p].slice(-2000)
          : s.gpsTrack;
      // distance only when a point was actually stored (filter already deadbands)
      const dist =
        track !== s.gpsTrack && last ? s.distanceM + haversineM(last, p) : s.distanceM;
      return {
        gpsTrack: track,
        distanceM: dist,
        maxSpeedMs: Math.max(s.maxSpeedMs, speedMs),
      };
    }),
  recordKnock: () => set((s) => ({ knockdowns: s.knockdowns + 1 })),
  recordAutoRespawn: () => set((s) => ({ autoRespawns: s.autoRespawns + 1 })),
  setMatchSummary: (matchSummary) => set({ matchSummary }),
  setMatchEnded: (matchEnded) => set({ matchEnded }),
  resetMatchStats: () => set({ ...emptyStats }),
  resetRoom: () =>
    set({
      roomCode: null,
      roomId: null,
      joinToken: null,
      isHost: false,
      selfPos: null,
      worldTick: null,
      pathfindingMode: "GRAPH_ASTAR",
      graphNotice: null,
      ...emptyStats,
    }),
}));

// hydrate session once per page load (client)
if (typeof window !== "undefined") {
  const s = readSession();
  if (!useGameStore.getState().playerId) {
    useGameStore.getState().setSession(s);
  }
}

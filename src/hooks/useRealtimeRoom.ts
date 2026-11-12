"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { PlayerTelemetry, RoomSnapshot, WorldStateTick, GameActionEvent } from "@/types/game";
import { useGameStore } from "@/store/useGameStore";
import { browserClient } from "@/lib/supabase";

interface UseRealtimeRoomOpts {
  roomCode: string;
  playerId: string | null;
  enabled: boolean;
  roomId?: string | null;
  onTick?: (tick: WorldStateTick) => void;
  onAction?: (action: GameActionEvent) => void;
  onLobby?: () => void;
}

export function useRealtimeRoom({
  roomCode,
  playerId,
  enabled,
  roomId,
  onTick,
  onAction,
  onLobby,
}: UseRealtimeRoomOpts) {
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const sbRef = useRef<SupabaseClient | null>(null);
  const lastSendRef = useRef(0);
  const callbacks = useRef({ onTick, onAction, onLobby });
  callbacks.current = { onTick, onAction, onLobby };
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;

  const sendTelemetry = useCallback((payload: PlayerTelemetry) => {
    const now = Date.now();
    if (now - lastSendRef.current < 1000) return false;
    lastSendRef.current = now;
    const ch = channelRef.current;
    if (!ch) return false;
    void ch.send({ type: "broadcast", event: "player_telemetry", payload });
    return true;
  }, []);

  const sendHeartbeat = useCallback(() => {
    const rid = roomIdRef.current;
    if (!rid || !playerId) return;
    const { distanceM, maxSpeedMs, joinToken, selfPos } = useGameStore.getState();
    void fetch("/api/rooms/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_id: rid,
        player_id: playerId,
        join_token: joinToken,
        distance_m: distanceM,
        max_speed_ms: maxSpeedMs,
        lat: selfPos?.lat,
        lng: selfPos?.lng,
      }),
    }).catch(() => {});
  }, [playerId]);

  useEffect(() => {
    if (!enabled || !roomCode || !playerId) {
      setConnected(false);
      return;
    }
    const sb = sbRef.current ?? browserClient();
    sbRef.current = sb;
    const channel = sb.channel(`room:${roomCode}`, { config: { broadcast: { self: false } } });

    channel
      .on("broadcast", { event: "world_state_tick" }, ({ payload }) => {
        callbacks.current.onTick?.(payload as WorldStateTick);
      })
      .on("broadcast", { event: "game_action" }, ({ payload }) => {
        callbacks.current.onAction?.(payload as GameActionEvent);
        if ((payload as GameActionEvent).action === "REMATCH") {
          callbacks.current.onLobby?.();
        }
      })
      .on("broadcast", { event: "lobby_state" }, () => {
        callbacks.current.onLobby?.();
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    const hb = window.setInterval(() => sendHeartbeat(), 5000);
    return () => {
      window.clearInterval(hb);
      void sb.removeChannel(channel);
      channelRef.current = null;
      setConnected(false);
    };
  }, [enabled, roomCode, playerId, sendHeartbeat]);

  const broadcastLobby = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: "broadcast", event: "lobby_state", payload: { at: Date.now() } });
  }, []);

  const broadcastAction = useCallback((action: GameActionEvent) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: "broadcast", event: "game_action", payload: action });
  }, []);

  const broadcastTick = useCallback((tick: WorldStateTick) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: "broadcast", event: "world_state_tick", payload: tick });
  }, []);

  return {
    connected,
    sendTelemetry,
    broadcastLobby,
    broadcastAction,
    broadcastTick,
  };
}

export async function fetchRoomSnapshot(code: string): Promise<RoomSnapshot | null> {
  const res = await fetch(`/api/rooms/${code.toUpperCase()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as RoomSnapshot;
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchRoomSnapshot,
  useRealtimeRoom,
} from "@/hooks/useRealtimeRoom";
import { useGPS } from "@/hooks/useGPS";
import { useGameStore } from "@/store/useGameStore";
import { GameMap } from "@/components/map/GameMap";
import { MatchSummary } from "@/components/summary/MatchSummary";
import { loadLastSummary } from "@/lib/lastSummary";
import type { RoomSnapshot } from "@/types/game";

interface LobbyViewProps {
  roomCode: string;
}

export function LobbyView({ roomCode }: LobbyViewProps) {
  const router = useRouter();
  const playerId = useGameStore((s) => s.playerId);
  const nickname = useGameStore((s) => s.nickname);
  const isHost = useGameStore((s) => s.isHost);
  const setRoom = useGameStore((s) => s.setRoom);
  const selfPos = useGameStore((s) => s.selfPos);
  const setSelfPos = useGameStore((s) => s.setSelfPos);

  const { status: gpsStatus, reading, start } = useGPS();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [starting, setStarting] = useState(false);
  const [phase, setPhase] = useState<"lobby" | "active" | "ended">("lobby");
  const [showSummary, setShowSummary] = useState(false);
  const lastSummary = useMemo(() => loadLastSummary(), []);

  const refresh = useCallback(async () => {
    const snap = await fetchRoomSnapshot(roomCode);
    if (!snap) {
      setError("Room not found");
      return;
    }
    setSnapshot(snap);
    setError(null);
    setPhase(snap.status === "ACTIVE" ? "active" : snap.status === "ENDED" ? "ended" : "lobby");
    setRoom({ roomCode: snap.room_code, isHost: snap.host_player_id === playerId });
    if (snap.host_player_id === playerId) {
      useGameStore.getState().setRoom({ roomCode: snap.room_code, isHost: true });
    }
  }, [roomCode, playerId, setRoom]);

  const { connected, broadcastLobby } = useRealtimeRoom({
    roomCode,
    playerId,
    enabled: Boolean(playerId),
    roomId: snapshot?.room_id ?? null,
    onLobby: () => {
      void refresh();
    },
  });

  useEffect(() => {
    void start();
    void refresh();
  }, [start, refresh]);

  useEffect(() => {
    if (!snapshot || phase === "ended") return;
    const id = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(id);
  }, [snapshot, phase, refresh]);

  useEffect(() => {
    if (reading) setSelfPos({ lat: reading.lat, lng: reading.lng });
  }, [reading, setSelfPos]);

  const center = useMemo(() => {
    if (selfPos) return selfPos;
    if (snapshot?.center_lat != null && snapshot.center_lng != null) {
      return { lat: snapshot.center_lat, lng: snapshot.center_lng };
    }
    return { lat: 16.054407, lng: 108.202167 };
  }, [selfPos, snapshot?.center_lat, snapshot?.center_lng]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyState("ok");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("fail");
    }
  };

  const onStart = async () => {
    if (!playerId || !snapshot) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: snapshot.room_id, requester_player_id: playerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Start failed");
        return;
      }
      setPhase("active");
      broadcastLobby();
      router.push(`/room/${roomCode}/play`);
    } catch {
      setError("Start failed");
    } finally {
      setStarting(false);
    }
  };

  if (error && !snapshot) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
        <h1 className="text-xl font-bold text-danger">{error}</h1>
        <button onClick={() => router.push("/")} className="rounded border border-line px-4 py-3">
          Home
        </button>
      </main>
    );
  }

  if (showSummary && lastSummary) {
    return (
      <MatchSummary
        roomCode={lastSummary.roomCode}
        roomId={lastSummary.roomId}
        summary={lastSummary.summary}
        endReason={lastSummary.summary.gameplay_metrics.end_reason}
        track={[]}
      />
    );
  }

  const players = snapshot?.players ?? [];
  const count = snapshot?.player_count ?? 0;
  const hostId = snapshot?.host_player_id;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
      <header className="flex items-baseline justify-between border-b border-line pb-2">
        <h1 className="text-xl font-bold tracking-widest text-safe">LOBBY</h1>
        <span className="text-xs text-muted">{connected ? "Live" : "Connecting…"}</span>
      </header>

      <div className="flex items-center gap-2">
        <span className="font-mono text-2xl tracking-[0.3em] text-text">{roomCode}</span>
        <button
          data-testid="copy-code"
          onClick={onCopy}
          className="rounded border border-line px-3 py-2 text-sm text-muted hover:border-safe hover:text-safe"
        >
          {copyState === "ok" ? "Copied" : copyState === "fail" ? "Failed" : "Copy"}
        </button>
      </div>

      <div className="rounded border border-line bg-panel p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Players</span>
          <span className="font-semibold text-text">{count}/10</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-muted">Status</span>
          <span className="text-text">{snapshot?.status ?? "…"}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-muted">GPS</span>
          <span className={gpsStatus === "granted" || gpsStatus === "simulated" ? "text-safe" : "text-warn"}>
            {gpsStatus}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-1" data-testid="roster">
        {players.map((p) => (
          <li
            key={p.player_id}
            className="flex items-center justify-between rounded border border-line bg-panel px-3 py-2"
          >
            <span className="text-sm text-text">
              {p.nickname}
              {p.player_id === playerId && <span className="text-muted"> (you)</span>}
            </span>
            <span className="text-xs">
              {p.player_id === hostId && <span className="text-warn">HOST</span>}
              {p.state !== "ALIVE" && <span className="ml-2 text-danger">{p.state}</span>}
            </span>
          </li>
        ))}
        {players.length === 0 && <li className="text-sm text-muted">Waiting for players…</li>}
      </ul>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {phase === "lobby" && (
        <button
          data-testid="start-match"
          onClick={onStart}
          disabled={!isHost || starting || count < 1}
          className="rounded bg-safe px-4 py-3 text-base font-bold text-bg disabled:opacity-40"
        >
          {isHost ? (starting ? "Starting…" : "Start Match") : "Waiting for host…"}
        </button>
      )}
      {phase === "active" && (
        <button
          onClick={() => router.push(`/room/${roomCode}/play`)}
          className="rounded border border-safe px-4 py-3 text-safe"
        >
          Enter Match
        </button>
      )}
      {phase === "ended" && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-warn">Match ended.</p>
          {lastSummary && (
            <button
              data-testid="last-summary"
              onClick={() => setShowSummary(true)}
              className="rounded border border-line px-4 py-3 text-sm text-text hover:border-safe hover:text-safe"
            >
              Open last summary
            </button>
          )}
        </div>
      )}

      <div className="relative h-[30vh] min-h-[200px] overflow-hidden rounded border border-line">
        <GameMap center={center} selfPos={selfPos} noise={reading?.noise ?? 0.05} />
      </div>

      <p className="text-center text-xs text-muted">
        Share code with friends. Max 10 players.
      </p>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GameMap } from "@/components/map/GameMap";
import { MatchSummary } from "@/components/summary/MatchSummary";
import { useGPS } from "@/hooks/useGPS";
import { useGameStore } from "@/store/useGameStore";
import { loadLastSummary } from "@/lib/lastSummary";
import { applyDevSimFromSearch } from "@/lib/devSim";
import { loadMatchProgress, clearMatchProgress } from "@/lib/matchProgress";
import type { GpsStatus } from "@/hooks/useGPS";

const GPS_LABEL: Record<GpsStatus, string> = {
  idle: "GPS: Off",
  requesting: "GPS: Requesting",
  granted: "GPS: On",
  denied: "GPS: Denied",
  unavailable: "GPS: Unavailable",
};

function ensurePlayerId(): string {
  const key = "outbreak_player_session";
  let raw = localStorage.getItem(key);
  if (!raw) {
    const id = crypto.randomUUID();
    raw = JSON.stringify({ player_id: id, nickname: "" });
    localStorage.setItem(key, raw);
  }
  return (JSON.parse(raw) as { player_id: string }).player_id;
}

export default function HomePage() {
  const router = useRouter();
  const { status, reading, start, devSim } = useGPS();
  const setSession = useGameStore((s) => s.setSession);
  const setSelfPos = useGameStore((s) => s.setSelfPos);
  const selfPos = useGameStore((s) => s.selfPos);
  const [nickname, setNickname] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [showLastSummary, setShowLastSummary] = useState(false);
  const lastSummary = useMemo(() => loadLastSummary(), []);
  const activeProgress = useMemo(() => loadMatchProgress(), []);

  useEffect(() => {
    const playerId = ensurePlayerId();
    setSession({ playerId, nickname: "" });
    applyDevSimFromSearch();
    start();
  }, [setSession, start]);

  useEffect(() => {
    if (status !== "requesting") setGpsReady(true);
  }, [status]);

  useEffect(() => {
    if (reading) setSelfPos({ lat: reading.lat, lng: reading.lng });
  }, [reading, setSelfPos]);

  const gpsOk = status === "granted";
  const canSubmit = useMemo(
    () => nickname.trim().length >= 2 && nickname.trim().length <= 30 && gpsOk,
    [nickname, gpsOk]
  );

  const center = useMemo(
    () => ({ lat: 16.054407, lng: 108.202167 }),
    []
  );

  if (showLastSummary && lastSummary) {
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

  const onHost = () => {
    if (!canSubmit) {
      setError("Nickname 2–30 chars + GPS required.");
      return;
    }
    setSession({ playerId: ensurePlayerId(), nickname: nickname.trim() });
    router.push("/room/create");
  };

  const onJoin = () => {
    if (!canSubmit) {
      setError("Nickname 2–30 chars + GPS required.");
      return;
    }
    const code = roomInput.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      setError("Room code: 6 chars, A–Z and 2–9.");
      return;
    }
    setSession({ playerId: ensurePlayerId(), nickname: nickname.trim() });
    router.push(`/room/${code}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo.webp"
            alt="OUTBREAK"
            width={32}
            height={32}
            className="h-8 w-8 rounded"
          />
          <h1 className="text-2xl font-bold tracking-widest text-safe">OUTBREAK</h1>
        </div>
        <span
          data-testid="gps-chip"
          className={`text-xs ${
            status === "granted"
              ? "text-safe"
              : status === "denied" || status === "unavailable"
                ? "text-danger"
                : "text-muted"
          }`}
        >
          {GPS_LABEL[status]}
          {devSim ? " · devsim" : ""}
        </span>
      </header>

      <p className="text-sm text-muted">
        Real-world GPS zombie survival. Walk the streets. Stay alive.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        Nickname
        <input
          data-testid="nickname-input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={30}
          placeholder="2–30 characters"
          className="rounded border border-line bg-panel px-3 py-3 text-base text-text outline-none focus:border-safe"
        />
      </label>

      <button
        data-testid="host-button"
        onClick={onHost}
        disabled={!canSubmit}
        className="rounded bg-safe px-4 py-3 text-base font-bold text-bg disabled:opacity-40"
      >
        Host New Game
      </button>

      <div className="flex gap-2">
        <input
          data-testid="room-code-input"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="ROOM CODE"
          className="min-w-0 flex-1 rounded border border-line bg-panel px-3 py-3 text-center font-mono text-base tracking-widest text-text outline-none focus:border-safe"
        />
        <button
          data-testid="join-button"
          onClick={onJoin}
          disabled={!canSubmit || roomInput.trim().length !== 6}
          className="rounded border border-safe px-4 py-3 text-base font-semibold text-safe disabled:opacity-40"
        >
          Join
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {activeProgress && (
        <button
          data-testid="resume-match"
          onClick={() => router.push(`/room/${activeProgress.roomCode}/play`)}
          className="rounded border border-safe bg-safe/10 px-4 py-3 text-base font-bold text-safe"
        >
          Resume match · {activeProgress.roomCode}
        </button>
      )}

      {lastSummary && (
        <button
          data-testid="last-summary"
          onClick={() => setShowLastSummary(true)}
          className="rounded border border-line px-4 py-2 text-sm text-muted hover:border-safe hover:text-safe"
        >
          Last summary · {lastSummary.roomCode}
        </button>
      )}

      {status === "denied" && (
        <p className="text-sm text-warn">
          Location denied. Enable GPS in browser settings to play.
        </p>
      )}
      {devSim && (
        <p className="text-xs text-muted">Dev sim on — append ?devsim=0 to disable.</p>
      )}
      {!gpsReady && status !== "denied" && (
        <p className="text-sm text-muted">Waiting for GPS…</p>
      )}

      {(selfPos || center) && (
        <div className="relative mt-2 h-[45vh] min-h-[280px] overflow-hidden rounded border border-line">
          <GameMap
            center={selfPos ?? center}
            selfPos={selfPos}
            noise={reading?.noise ?? 0.05}
          />
        </div>
      )}
    </main>
  );
}

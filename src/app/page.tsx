"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GameMap } from "@/components/map/GameMap";
import { MatchSummary } from "@/components/summary/MatchSummary";
import { useGPS } from "@/hooks/useGPS";
import { useGameStore } from "@/store/useGameStore";
import { loadLastSummary, type LastSummary } from "@/lib/lastSummary";
import { applyDevSimFromSearch } from "@/lib/devSim";
import { loadMatchProgress, clearMatchProgress, type MatchProgress } from "@/lib/matchProgress";
import { readSession } from "@/lib/session";
import type { GpsStatus } from "@/hooks/useGPS";

const GPS_LABEL: Record<GpsStatus, string> = {
  idle: "GPS: Off",
  requesting: "GPS: Requesting",
  granted: "GPS: On",
  denied: "GPS: Denied",
  unavailable: "GPS: Unavailable",
};

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
  // null on SSR + first client render — localStorage fills after mount (hydration-safe)
  const [lastSummary, setLastSummary] = useState<LastSummary | null>(null);
  const [activeProgress, setActiveProgress] = useState<MatchProgress | null>(null);

  useEffect(() => {
    const s = readSession();
    setSession(s);
    setNickname(s.nickname);
    setLastSummary(loadLastSummary());
    setActiveProgress(loadMatchProgress());
    applyDevSimFromSearch();
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setSession({ ...readSession(), nickname: nickname.trim() });
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
    setSession({ ...readSession(), nickname: nickname.trim() });
    router.push(`/room/${code}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between border-b border-line pb-3">
        <h1 className="text-2xl font-bold tracking-widest text-safe">OUTBREAK</h1>
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

      {/* map preview removed for cleaner home */}
    </main>
  );
}

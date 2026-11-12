"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LatLng, MatchSummaryJson } from "@/types/game";
import { renderShareCard, shareOrDownload } from "@/lib/shareCard";
import { useGameStore } from "@/store/useGameStore";

interface MatchSummaryProps {
  roomCode: string;
  roomId: string | null;
  summary: MatchSummaryJson;
  endReason: string;
  track: LatLng[];
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function MatchSummary({ roomCode, roomId, summary, endReason, track }: MatchSummaryProps) {
  const router = useRouter();
  const isHost = useGameStore((s) => s.isHost);
  const playerId = useGameStore((s) => s.playerId);
  const joinToken = useGameStore((s) => s.joinToken);
  const nickname = useGameStore((s) => s.nickname) ?? "Survivor";
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [shareState, setShareState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const gm = summary.gameplay_metrics;
  const me = summary.players.find((p) => p.player_id === playerId) ?? summary.players[0];

  const title = endReason === "ALL_KNOCKED" ? "FULL TEAM DOWN" : "SURVIVAL SESSION ENDED";

  const teamRows = useMemo(
    () =>
      [...summary.players].sort((a, b) => b.distance_m - a.distance_m),
    [summary.players]
  );

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPhoto(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const onShare = async () => {
    setBusy(true);
    setShareState(null);
    try {
      const blob = await renderShareCard({
        title,
        roomCode,
        nickname,
        durationSec: gm.match_duration_sec,
        distanceM: me?.distance_m ?? gm.total_team_distance_m,
        maxSpeedMs: me?.max_speed_ms ?? 0,
        rescues: me?.rescues_count ?? 0,
        knockdowns: gm.total_knockdowns,
        endReason,
        track,
        photo,
      });
      const result = await shareOrDownload(blob, `outbreak-${roomCode}.png`);
      setShareState(result === "shared" ? "Shared" : "Downloaded PNG");
    } catch {
      setShareState("Share failed");
    } finally {
      setBusy(false);
    }
  };

  const onRematch = async () => {
    if (!roomId || !playerId) return;
    setRematching(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/rematch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, requester_player_id: playerId, join_token: joinToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Rematch failed");
        return;
      }
      useGameStore.getState().resetMatchStats();
      useGameStore.getState().setMatchEnded(false);
      useGameStore.getState().setMatchSummary(null);
      router.push(`/room/${roomCode}`);
    } catch {
      setError("Rematch failed");
    } finally {
      setRematching(false);
    }
  };

  return (
    <main
      className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 p-4"
      data-testid="match-summary"
    >
      <header
        className="relative overflow-hidden rounded border-b border-line bg-cover bg-center pb-2"
        style={{ backgroundImage: "url('/brand/banner-169.webp')" }}
      >
        <div className="bg-bg/70 px-2 py-2 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-widest text-danger">{endReason.replace(/_/g, " ")}</p>
          <h1 className="text-[28px] font-bold leading-tight text-text">{title}</h1>
          <p className="text-sm text-muted">
            Room {roomCode} · {nickname}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2" data-testid="summary-stats">
        <Stat label="Survival" value={fmtDuration(gm.match_duration_sec)} />
        <Stat label="Team distance" value={fmtDist(gm.total_team_distance_m)} />
        <Stat label="Your distance" value={fmtDist(me?.distance_m ?? 0)} />
        <Stat
          label="Your max speed"
          value={`${((me?.max_speed_ms ?? 0) * 3.6).toFixed(1)} km/h`}
        />
        <Stat label="Rescues" value={String(gm.successful_rescues)} />
        <Stat label="Knockdowns" value={String(gm.total_knockdowns)} />
        <Stat label="Auto respawns" value={String(gm.auto_respawns_at_safezone)} />
        <Stat label="Pathfinding" value={summary.tech_metrics.pathfinding_mode ?? "—"} />
      </section>

      <section className="rounded border border-line bg-panel p-3">
        <h2 className="mb-2 text-sm font-semibold text-muted">Squad</h2>
        <ul className="flex flex-col gap-1">
          {teamRows.map((p) => (
            <li
              key={p.player_id}
              className="flex items-center justify-between text-sm"
              data-testid="summary-player"
            >
              <span className="text-text">
                {p.nickname}
                {p.player_id === playerId && <span className="text-muted"> (you)</span>}
              </span>
              <span className="font-mono text-xs text-muted">
                {fmtDist(p.distance_m)} · {p.rescues_count} r · HP {p.max_hp}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded border border-line bg-panel p-3">
        <h2 className="mb-2 text-sm font-semibold text-muted">Share card</h2>
        <div className="flex flex-col gap-2">
          <button
            data-testid="pick-photo"
            onClick={() => fileRef.current?.click()}
            className="rounded border border-line px-3 py-3 text-sm text-text"
          >
            {photo ? "Change photo background" : "Add photo background"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPhoto(e.target.files?.[0])}
          />
          <button
            data-testid="share-card"
            onClick={() => void onShare()}
            disabled={busy}
            className="rounded bg-safe px-4 py-3 text-sm font-bold text-bg disabled:opacity-40"
          >
            {busy ? "Rendering…" : "Share / Save card"}
          </button>
          {shareState && <p className="text-xs text-safe">{shareState}</p>}
          <p className="text-xs text-muted">
            Default card draws your GPS route. Photo stays on device.
          </p>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2 pb-4">
        {isHost && (
          <button
            data-testid="rematch"
            onClick={() => void onRematch()}
            disabled={rematching}
            className="rounded border border-safe px-4 py-3 text-safe disabled:opacity-40"
          >
            {rematching ? "Rematching…" : "REMATCH ROOM"}
          </button>
        )}
        <button
          data-testid="back-home"
          onClick={() => router.push("/")}
          className="rounded border border-line px-4 py-3 text-muted"
        >
          Back to home
        </button>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-panel px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-mono text-lg font-bold tabular-nums text-text">{value}</p>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldStateTick } from "@/types/game";
import { RESCUE_HOLD_MS } from "@/engine/survivalRules";
import { haversineM } from "@/lib/geoUtils";

interface SurvivalHUDProps {
  tick: WorldStateTick | null;
  playerId: string | null;
  isHost: boolean;
  nickname: string | null;
  onCreateZone?: () => void;
  zoneCooldownSec?: number;
  onEndMatch?: () => void;
  onRescue?: (victimId: string) => void;
  rescuePending?: boolean;
  statusLine?: string;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SurvivalHUD({
  tick,
  playerId,
  isHost,
  nickname,
  onCreateZone,
  zoneCooldownSec = 0,
  onEndMatch,
  onRescue,
  rescuePending = false,
  statusLine,
}: SurvivalHUDProps) {
  const self = tick?.players.find((p) => p.player_id === playerId) ?? null;
  const hp = self?.hp ?? 100;
  const maxHp = self?.max_hp ?? 100;
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  const knocked = self?.state === "KNOCKED";
  const knockLeft = self?.knocked_remaining_sec ?? 0;

  const [holdMs, setHoldMs] = useState(0);
  const holdRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // nearest knocked teammate for rescue
  const rescueTarget = (() => {
    if (!tick || !self || self.state !== "ALIVE") return null;
    let best: { id: string; dist: number; remaining: number } | null = null;
    for (const p of tick.players) {
      if (p.player_id === playerId || p.state !== "KNOCKED") continue;
      if (p.knocked_remaining_sec == null || p.knocked_remaining_sec <= 0) continue;
      const dist = haversineM({ lat: self.lat, lng: self.lng }, { lat: p.lat, lng: p.lng });
      if (dist <= 10 && (!best || dist < best.dist)) {
        best = { id: p.player_id, dist, remaining: p.knocked_remaining_sec };
      }
    }
    return best;
  })();

  const stopHold = (complete: boolean) => {
    if (holdRef.current != null) {
      window.clearInterval(holdRef.current);
      holdRef.current = null;
    }
    if (complete && rescueTarget && onRescue) onRescue(rescueTarget.id);
    setHoldMs(0);
  };

  const startHold = () => {
    if (!rescueTarget || rescuePending || holdRef.current != null) return;
    holdStartRef.current = Date.now();
    holdRef.current = window.setInterval(() => {
      const el = Date.now() - holdStartRef.current;
      if (el >= RESCUE_HOLD_MS) {
        stopHold(true);
        return;
      }
      if (rescueTarget && tick) {
        const me = tick.players.find((p) => p.player_id === playerId);
        const victim = tick.players.find((p) => p.player_id === rescueTarget.id);
        if (me && victim) {
          const d = haversineM(
            { lat: me.lat, lng: me.lng },
            { lat: victim.lat, lng: victim.lng }
          );
          if (d > 10) {
            stopHold(false);
            return;
          }
        }
      }
      setHoldMs(el);
    }, 50);
  };

  useEffect(
    () => () => {
      if (holdRef.current != null) window.clearInterval(holdRef.current);
    },
    []
  );

  const hpColor = hpPct <= 30 ? "bg-danger" : "bg-safe";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-2">
      <div className="pointer-events-auto rounded border border-line bg-bg/90 px-3 py-2 ">
        <div className="flex items-center justify-between gap-3 text-xs">
          <div className="flex-1">
            <div className="mb-1">
              <span className="text-base font-bold text-text">{nickname ?? "Survivor"}</span>
            </div>
            <div
              className="mb-1 text-xs text-muted"
              aria-live="polite"
              data-testid="hp-label"
            >
              HP {Math.round(hp)}/{maxHp}
            </div>
            <div
              role="progressbar"
              aria-valuenow={Math.round(hp)}
              aria-valuemax={maxHp}
              aria-label={`Health ${Math.round(hp)} of ${maxHp}`}
              className="h-3 overflow-hidden rounded-full bg-border"
            >
              <div
                className={`h-full ${hpColor} transition-all duration-300`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
          </div>
          <div className="text-right font-mono text-sm tabular-nums">
            <div className="text-safe" data-testid="match-timer">
              {fmtTime(tick?.elapsed_sec ?? 0)}
            </div>
          </div>
        </div>
        {statusLine && <p className="mt-1 text-xs text-muted">{statusLine}</p>}
      </div>

      {knocked && (
        <div
          className="pointer-events-auto rounded border border-danger bg-danger/20 px-3 py-3 text-center backdrop-blur"
          data-testid="knocked-overlay"
        >
          <p className="text-sm font-bold text-danger">KNOCKED</p>
          <p className="mt-1 text-xs text-text" aria-live="polite">
            Waiting for rescue… {Math.ceil(knockLeft)}s
            {playersCount(tick) === 1 ? " (solo — ending)" : " (or auto Safe Zone)"}
          </p>
        </div>
      )}

      <div className="pointer-events-auto flex flex-col gap-2">
        {rescueTarget && !knocked && (
          <button
            data-testid="rescue-hold"
            aria-label="Rescue teammate, hold 3 seconds"
            disabled={rescuePending}
            onPointerDown={startHold}
            onPointerUp={() => stopHold(false)}
            onPointerLeave={() => stopHold(false)}
            onPointerCancel={() => stopHold(false)}
            className="relative h-16 overflow-hidden rounded border border-safe bg-safe/20 px-4 text-sm font-bold text-safe disabled:opacity-40"
          >
            <span
              className="absolute inset-y-0 left-0 bg-safe/40"
              style={{ width: `${(holdMs / RESCUE_HOLD_MS) * 100}%` }}
            />
            <span className="relative">
              HOLD RESCUE · {rescueTarget.dist.toFixed(1)}m
            </span>
          </button>
        )}

        {isHost && (
          <div className="flex gap-2">
            <button
              data-testid="create-zone"
              onClick={onCreateZone}
              disabled={zoneCooldownSec > 0}
              className="flex-1 rounded border border-safe bg-bg/90 px-3 py-3 text-xs font-bold text-safe disabled:opacity-40"
            >
              {zoneCooldownSec > 0
                ? `ZONE ${Math.ceil(zoneCooldownSec / 60)}:${String(Math.ceil(zoneCooldownSec) % 60).padStart(2, "0")}`
                : "CREATE ZONE"}
            </button>
            {!confirmEnd ? (
              <button
                data-testid="end-match"
                onClick={() => setConfirmEnd(true)}
                className="flex-1 rounded border border-danger bg-bg/90 px-3 py-3 text-xs font-bold text-danger"
              >
                END
              </button>
            ) : (
              <button
                data-testid="confirm-end"
                onClick={() => {
                  setConfirmEnd(false);
                  onEndMatch?.();
                }}
                className="flex-1 rounded bg-danger px-3 py-3 text-xs font-bold text-bg"
              >
                CONFIRM END
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function playersCount(tick: WorldStateTick | null): number {
  return tick?.players.length ?? 0;
}

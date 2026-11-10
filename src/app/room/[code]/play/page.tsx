"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { GameMap } from "@/components/map/GameMap";
import { SurvivalHUD } from "@/components/hud/SurvivalHUD";
import { MatchSummary } from "@/components/summary/MatchSummary";
import { useGPS } from "@/hooks/useGPS";
import { useRealtimeRoom, fetchRoomSnapshot } from "@/hooks/useRealtimeRoom";
import { useGameStore } from "@/store/useGameStore";
import { loadRoadGraph, type PathfindingMode } from "@/engine/osmGraph";
import { HOST_MIGRATE_MS } from "@/engine/connectionGrace";
import { saveLastSummary } from "@/lib/lastSummary";
import type { PlayerWorld, WorkerIn, WorkerOut, Density } from "@/engine/roomTick.worker";
import type {
  EndReason,
  MatchSummaryJson,
  PlayerTelemetry,
  RoomSnapshot,
  SafeZoneTick,
  WorldStateTick,
} from "@/types/game";

const DENSITY: Density = "MEDIUM";

function loadSession(): { playerId: string; nickname: string } {
  const raw = localStorage.getItem("outbreak_player_session");
  if (!raw) return { playerId: crypto.randomUUID(), nickname: "" };
  const parsed = JSON.parse(raw) as {
    player_id?: string;
    playerId?: string;
    nickname?: string;
  };
  return {
    playerId: parsed.player_id ?? parsed.playerId ?? crypto.randomUUID(),
    nickname: parsed.nickname ?? "",
  };
}

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const roomCode = (params.code ?? "").toUpperCase();
  const playerId = useGameStore((s) => s.playerId);
  const nickname = useGameStore((s) => s.nickname);
  const isHost = useGameStore((s) => s.isHost);
  const selfPos = useGameStore((s) => s.selfPos);
  const worldTick = useGameStore((s) => s.worldTick);
  const setWorldTick = useGameStore((s) => s.setWorldTick);
  const setPathfinding = useGameStore((s) => s.setPathfinding);
  const graphNotice = useGameStore((s) => s.graphNotice);
  const pathfindingMode = useGameStore((s) => s.pathfindingMode);
  const setSelfPos = useGameStore((s) => s.setSelfPos);
  const matchEnded = useGameStore((s) => s.matchEnded);
  const matchSummary = useGameStore((s) => s.matchSummary);
  const setMatchSummary = useGameStore((s) => s.setMatchSummary);
  const setMatchEnded = useGameStore((s) => s.setMatchEnded);
  const recordGps = useGameStore((s) => s.recordGps);
  const recordKnock = useGameStore((s) => s.recordKnock);
  const recordAutoRespawn = useGameStore((s) => s.recordAutoRespawn);
  const gpsTrack = useGameStore((s) => s.gpsTrack);
  const distanceM = useGameStore((s) => s.distanceM);
  const maxSpeedMs = useGameStore((s) => s.maxSpeedMs);
  const knockdowns = useGameStore((s) => s.knockdowns);
  const autoRespawns = useGameStore((s) => s.autoRespawns);
  const { reading, start } = useGPS();

  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<string>("Loading match…");
  const [zoneCooldownSec, setZoneCooldownSec] = useState(0);
  const [rescuePending, setRescuePending] = useState(false);
  const [endedLocally, setEndedLocally] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const playersRef = useRef<Map<string, PlayerWorld>>(new Map());
  const broadcastTickRef = useRef<((t: WorldStateTick) => void) | null>(null);
  const broadcastActionRef = useRef<
    ((a: import("@/types/game").GameActionEvent) => void) | null
  >(null);
  const session = useRef(loadSession());
  const endingRef = useRef(false);
  const endReasonRef = useRef<EndReason>("HOST_ENDED");
  const lastTickAtRef = useRef(0);
  const restoreTickRef = useRef<WorldStateTick | null>(null);
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  snapshotRef.current = snapshot;
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  useEffect(() => {
    void start();
    void fetchRoomSnapshot(roomCode).then((snap) => {
      setSnapshot(snap);
      if (!snap) setStatus("Room not found");
      else {
        useGameStore.getState().setRoom({
          roomCode: snap.room_code,
          isHost: snap.host_player_id === useGameStore.getState().playerId,
          roomId: snap.room_id,
        });
        if (snap.status === "ENDED") {
          setEndedLocally(true);
          setMatchEnded(true);
        }
      }
    });
  }, [roomCode, start, setMatchEnded]);

  useEffect(() => {
    if (reading) {
      setSelfPos({ lat: reading.lat, lng: reading.lng });
      recordGps({ lat: reading.lat, lng: reading.lng }, reading.speed_ms);
    }
  }, [reading, setSelfPos, recordGps]);

  const onTick = useCallback(
    (tick: WorldStateTick) => {
      lastTickAtRef.current = Date.now();
      setWorldTick(tick);
    },
    [setWorldTick]
  );

  const prevSelfState = useRef<string>("ALIVE");
  useEffect(() => {
    const self = worldTick?.players.find((p) => p.player_id === playerId);
    if (!self) return;
    if (prevSelfState.current === "ALIVE" && self.state === "KNOCKED") {
      recordKnock();
    }
    prevSelfState.current = self.state;
  }, [worldTick, playerId, recordKnock]);

  const doEndMatch = useCallback(
    async (reason: EndReason) => {
      if (endingRef.current) return;
      const snap = snapshot;
      const rid = snap?.room_id ?? useGameStore.getState().roomId;
      if (!rid || !playerId) return;
      endingRef.current = true;
      endReasonRef.current = reason;
      try {
        const res = await fetch("/api/rooms/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: rid,
            requester_player_id: playerId,
            reason,
            knockdowns: useGameStore.getState().knockdowns,
            auto_respawns: useGameStore.getState().autoRespawns,
            pathfinding_mode: useGameStore.getState().pathfindingMode,
          }),
        });
        const data = (await res.json()) as {
          error?: { message: string };
          summary?: MatchSummaryJson;
          end_reason?: EndReason;
        };
        if (!res.ok) {
          setStatus(data.error?.message ?? "End failed");
          endingRef.current = false;
          return;
        }
        if (data.summary) {
          setMatchSummary(data.summary);
          saveLastSummary({
            roomCode,
            roomId: rid,
            summary: data.summary,
          });
        }
        setMatchEnded(true);
        setEndedLocally(true);
        setStatus("Match ended");
      } catch {
        setStatus("End failed");
        endingRef.current = false;
      }
    },
    [snapshot, playerId, roomCode, setMatchSummary, setMatchEnded]
  );

  const syncPlayerState = useCallback(
    async (targetId: string, state: "ALIVE" | "KNOCKED", extra?: { max_hp?: number; hp?: number }) => {
      const rid = snapshotRef.current?.room_id ?? useGameStore.getState().roomId;
      const hostId = playerIdRef.current;
      if (!rid || !hostId || !isHostRef.current) return;
      try {
        await fetch("/api/rooms/player-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: rid,
            requester_player_id: hostId,
            target_player_id: targetId,
            state,
            ...extra,
          }),
        });
      } catch {
        /* rescue RPC may still fail — UI shows status */
      }
    },
    []
  );

  const { connected, broadcastTick, broadcastAction, sendTelemetry } = useRealtimeRoom({
    roomCode,
    playerId,
    enabled: Boolean(playerId),
    roomId: snapshot?.room_id ?? null,
    onTick,
    onAction: (action) => {
      if (action.action === "MATCH_ENDED") {
        const summary = action.data.summary as MatchSummaryJson | undefined;
        if (summary) {
          setMatchSummary(summary);
          saveLastSummary({
            roomCode,
            roomId: snapshotRef.current?.room_id ?? null,
            summary,
          });
        }
        setMatchEnded(true);
        setEndedLocally(true);
        workerRef.current?.postMessage({ type: "stop" } satisfies WorkerIn);
      } else if (action.action === "HOST_MIGRATED") {
        const newHost = action.data.new_host_player_id as string | undefined;
        if (newHost && newHost === playerIdRef.current) {
          restoreTickRef.current = useGameStore.getState().worldTick;
          useGameStore.getState().setRoom({
            roomCode,
            isHost: true,
            roomId: snapshotRef.current?.room_id ?? null,
          });
          setStatus("You are now host — restoring world…");
        }
      } else if (action.action === "SPAWN_SAFE_ZONE") {
        const zone = action.data as unknown as SafeZoneTick;
        if (isHost && zone?.id) {
          workerRef.current?.postMessage({ type: "add_zone", zone } satisfies WorkerIn);
        }
      } else if (action.action === "RESCUE") {
        const victimId = action.data.victim_id as string | undefined;
        if (victimId && isHost) {
          workerRef.current?.postMessage({
            type: "apply_rescue",
            rescuerId: action.actor_player_id ?? "",
            victimId,
          } satisfies WorkerIn);
        }
      } else if (action.action === "AUTO_RESPAWN") {
        recordAutoRespawn();
      } else if (action.action === "REMATCH") {
        useGameStore.getState().resetMatchStats();
        setMatchEnded(false);
        setMatchSummary(null);
        setEndedLocally(false);
        endingRef.current = false;
      }
    },
  });
  broadcastTickRef.current = broadcastTick;
  broadcastActionRef.current = broadcastAction;

  useEffect(() => {
    if (!snapshot) return;
    for (const p of snapshot.players) {
      if (!playersRef.current.has(p.player_id)) {
        playersRef.current.set(p.player_id, {
          player_id: p.player_id,
          nickname: p.nickname,
          state: p.state,
          hp: p.hp,
          max_hp: p.max_hp,
          lat: snapshot.center_lat ?? 16.054407,
          lng: snapshot.center_lng ?? 108.202167,
          noise: 0.05,
          in_safe_zone: false,
          knocked_remaining_sec: null,
        });
      }
    }
  }, [snapshot]);

  useEffect(() => {
    if (!reading || !playerId) return;
    const w = playersRef.current.get(playerId);
    if (w) {
      w.lat = reading.lat;
      w.lng = reading.lng;
      w.noise = reading.noise;
    }
    const telemetry: PlayerTelemetry = {
      player_id: playerId,
      lat: reading.lat,
      lng: reading.lng,
      speed_ms: reading.speed_ms,
      noise_level: reading.noise,
      distance_delta_m: 0,
      accuracy_m: reading.accuracy_m,
      flags: reading.flags,
      timestamp: reading.timestamp,
    };
    sendTelemetry(telemetry);
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({
        type: "players",
        players: [...playersRef.current.values()],
      } satisfies WorkerIn);
    }
  }, [reading, playerId, sendTelemetry]);

  // host: load graph + start worker once snapshot ACTIVE
  useEffect(() => {
    if (!isHost || !snapshot || snapshot.status !== "ACTIVE") return;
    if (workerRef.current) return;
    if (endedLocally || matchEnded) return;
    let cancelled = false;

    (async () => {
      setStatus("Loading road graph…");
      const center = {
        lat: snapshot.center_lat ?? reading?.lat ?? 16.054407,
        lng: snapshot.center_lng ?? reading?.lng ?? 108.202167,
      };
      const graphResult = await loadRoadGraph(center);
      if (cancelled) return;
      const mode: PathfindingMode = graphResult.mode;
      setPathfinding(
        mode,
        mode === "DIRECT_VECTOR_FALLBACK"
          ? "⚠️ Road data busy — Zombies in free-move mode."
          : null
      );

      const worker = new Worker(new URL("../../../../engine/roomTick.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const msg = ev.data;
        if (msg.type === "ready") {
          setStatus(`Zombies: ${msg.zombieCount} (${msg.mode})`);
        } else if (msg.type === "tick") {
          for (const p of msg.payload.players) {
            const w = playersRef.current.get(p.player_id);
            if (w) {
              w.hp = p.hp;
              w.max_hp = p.max_hp;
              w.state = p.state;
              w.in_safe_zone = p.in_safe_zone;
              w.knocked_remaining_sec = p.knocked_remaining_sec;
              w.lat = p.lat;
              w.lng = p.lng;
            }
          }
          setWorldTick(msg.payload);
          broadcastTickRef.current?.(msg.payload);
        } else if (msg.type === "slow_tick") {
          console.warn(`[tick] over budget: ${msg.ms.toFixed(1)} ms`);
        } else if (msg.type === "player_knocked") {
          if (msg.solo) {
            void doEndMatch("ALL_KNOCKED");
          } else {
            void syncPlayerState(msg.player_id, "KNOCKED");
          }
        } else if (msg.type === "auto_respawn") {
          recordAutoRespawn();
          void syncPlayerState(msg.player_id, "ALIVE", { max_hp: msg.new_max_hp, hp: msg.new_max_hp });
          broadcastActionRef.current?.({
            action: "AUTO_RESPAWN",
            actor_player_id: msg.player_id,
            data: { player_id: msg.player_id, new_max_hp: msg.new_max_hp, zone_id: msg.zone_id },
          });
          const w = playersRef.current.get(msg.player_id);
          if (w) {
            w.state = "ALIVE";
            w.max_hp = msg.new_max_hp;
            w.hp = msg.new_max_hp;
            w.knocked_remaining_sec = null;
          }
        } else if (msg.type === "match_end") {
          void doEndMatch(msg.reason);
        }
      };

      const init: WorkerIn = {
        type: "init",
        graph: graphResult.graph,
        mode,
        center,
        players: [...playersRef.current.values()],
        density: DENSITY,
        startedAt: Date.now(),
        restoreTick: restoreTickRef.current ?? undefined,
      };
      restoreTickRef.current = null;
      worker.postMessage(init);
      setStatus("Starting AI tick…");
    })();

    return () => {
      cancelled = true;
      workerRef.current?.postMessage({ type: "stop" } satisfies WorkerIn);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, snapshot?.status, snapshot?.room_id, endedLocally, matchEnded]);

  useEffect(() => {
    if (!isHost && worldTick) {
      setStatus(`Live · tick ${worldTick.tick_id}`);
    }
  }, [isHost, worldTick]);

  // zone cooldown countdown (local after create)
  useEffect(() => {
    if (zoneCooldownSec <= 0) return;
    const id = window.setInterval(() => {
      setZoneCooldownSec((c) => Math.max(0, c - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [zoneCooldownSec]);

  const onCreateZone = useCallback(async () => {
    const rid = snapshot?.room_id ?? useGameStore.getState().roomId;
    const pos = selfPos ?? (worldTick?.players.find((p) => p.player_id === playerId)
      ? { lat: worldTick.players.find((p) => p.player_id === playerId)!.lat, lng: worldTick.players.find((p) => p.player_id === playerId)!.lng }
      : null);
    if (!rid || !playerId || !pos) return;
    try {
      const res = await fetch("/api/rooms/safe-zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: rid,
          requester_player_id: playerId,
          lat: pos.lat,
          lng: pos.lng,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data?.error?.message ?? "Zone failed");
        if (data?.error?.code === "RATE_LIMITED") setZoneCooldownSec(600);
        return;
      }
      setZoneCooldownSec(600);
      setStatus("Safe zone created (3 min)");
    } catch {
      setStatus("Zone failed");
    }
  }, [snapshot, selfPos, worldTick, playerId]);

  const onRescue = useCallback(
    async (victimId: string) => {
      if (!playerId || rescuePending) return;
      const me = worldTick?.players.find((p) => p.player_id === playerId);
      const victim = worldTick?.players.find((p) => p.player_id === victimId);
      if (!me || !victim) return;
      setRescuePending(true);
      try {
        const res = await fetch("/api/rescue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rescuer_id: playerId,
            victim_id: victimId,
            rescuer_lat: me.lat,
            rescuer_lng: me.lng,
            victim_lat: victim.lat,
            victim_lng: victim.lng,
          }),
        });
        const data = (await res.json()) as {
          rescued?: boolean;
          error?: { message: string };
        };
        if (!res.ok) {
          setStatus(data.error?.message ?? "Rescue failed");
          return;
        }
        if (data.rescued) {
          broadcastActionRef.current?.({
            action: "RESCUE",
            actor_player_id: playerId,
            data: { victim_id: victimId, victim_hp: 50 },
          });
          if (isHost) {
            workerRef.current?.postMessage({
              type: "apply_rescue",
              rescuerId: playerId,
              victimId,
            } satisfies WorkerIn);
          }
          setStatus("Rescue success");
        } else {
          setStatus("Rescue failed — too far or invalid");
        }
      } catch {
        setStatus("Rescue failed");
      } finally {
        setRescuePending(false);
      }
    },
    [playerId, worldTick, rescuePending, isHost]
  );

  const onEndMatch = useCallback(() => {
    void doEndMatch("HOST_ENDED");
  }, [doEndMatch]);

  // fetch match result if ended without summary
  useEffect(() => {
    if (!matchEnded || matchSummary || !snapshot) return;
    void (async () => {
      const res = await fetch(`/api/matches/${snapshot.room_id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { summary_json?: MatchSummaryJson };
      if (data.summary_json) {
        setMatchSummary(data.summary_json);
        saveLastSummary({
          roomCode,
          roomId: snapshot.room_id,
          summary: data.summary_json,
        });
      }
    })();
  }, [matchEnded, matchSummary, snapshot, roomCode, setMatchSummary]);

  // non-host: host silent > 15s → request migration
  useEffect(() => {
    if (isHost || matchEnded || !snapshot?.room_id || !playerId) return;
    const id = window.setInterval(() => {
      const last = lastTickAtRef.current;
      if (!last || Date.now() - last <= HOST_MIGRATE_MS) return;
      if (endingRef.current) return;
      void fetch("/api/rooms/migrate-host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: snapshot.room_id,
          requester_player_id: playerId,
        }),
      }).catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [isHost, matchEnded, snapshot?.room_id, playerId]);

  // dev-only force knock for e2e
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEV_SIMULATE_GPS !== "true") return;
    const w = window as unknown as {
      __outbreak?: { forceKnock: (id?: string) => void };
    };
    w.__outbreak = {
      forceKnock: (id) => {
        const pid = id ?? useGameStore.getState().playerId;
        if (!pid) return;
        const p = playersRef.current.get(pid);
        if (!p) return;
        p.state = "KNOCKED";
        p.hp = 0;
        p.knocked_remaining_sec = 60;
        workerRef.current?.postMessage({
          type: "players",
          players: [...playersRef.current.values()],
        } satisfies WorkerIn);
        if (isHostRef.current) void syncPlayerState(pid, "KNOCKED");
      },
    };
    return () => {
      delete w.__outbreak;
    };
  }, [syncPlayerState]);

  if (matchEnded && matchSummary) {
    return (
      <MatchSummary
        roomCode={roomCode}
        roomId={snapshot?.room_id ?? null}
        summary={matchSummary}
        endReason={matchSummary.gameplay_metrics.end_reason}
        track={gpsTrack}
      />
    );
  }

  const center =
    selfPos ??
    (snapshot?.center_lat != null && snapshot.center_lng != null
      ? { lat: snapshot.center_lat, lng: snapshot.center_lng }
      : { lat: 16.054407, lng: 108.202167 });

  const selfFromTick = worldTick?.players.find((p) => p.player_id === playerId);
  const displayPos = selfFromTick ? { lat: selfFromTick.lat, lng: selfFromTick.lng } : selfPos;
  const noise = selfFromTick?.noise ?? reading?.noise ?? 0.05;

  return (
    <main className="relative flex h-[100dvh] flex-col">
      <header className="z-10 flex items-center justify-between border-b border-line bg-bg/90 px-3 py-2">
        <h1 className="text-sm font-bold tracking-widest text-safe">MATCH {roomCode}</h1>
        <div className="flex items-center gap-2 text-xs">
          <span className={connected ? "text-safe" : "text-warn"}>
            {connected ? "Live" : "Connecting…"}
          </span>
          <span className="text-muted">{isHost ? "HOST" : "CLIENT"}</span>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <GameMap
          center={center}
          selfPos={displayPos}
          noise={noise}
          zombies={worldTick?.zombies ?? []}
          worldTick={worldTick}
        />
        <SurvivalHUD
          tick={worldTick}
          playerId={playerId}
          isHost={isHost}
          nickname={nickname}
          onCreateZone={() => void onCreateZone()}
          zoneCooldownSec={zoneCooldownSec}
          onEndMatch={onEndMatch}
          onRescue={(id) => void onRescue(id)}
          rescuePending={rescuePending}
          statusLine={status}
        />
      </div>

      <footer className="z-10 border-t border-line bg-bg/90 px-3 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">{status}</span>
          <span className="text-muted">{pathfindingMode}</span>
        </div>
        {graphNotice && <p className="mt-1 text-warn">{graphNotice}</p>}
        <div className="mt-1 flex gap-3 text-muted">
          <span>t+{worldTick?.elapsed_sec ?? 0}s</span>
          <span>zombies {worldTick?.zombies.length ?? 0}</span>
          <span>zones {worldTick?.safe_zones.length ?? 0}</span>
          <span>dist {Math.round(distanceM)}m</span>
          <span>max {(maxSpeedMs * 3.6).toFixed(1)}km/h</span>
          <span>knocks {knockdowns}</span>
        </div>
        {!isHost && !worldTick && (
          <p className="mt-1 text-muted">Waiting for host tick…</p>
        )}
      </footer>
    </main>
  );
}

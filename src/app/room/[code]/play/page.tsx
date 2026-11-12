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
import {
  saveMatchProgress,
  loadMatchProgress,
  clearMatchProgress,
} from "@/lib/matchProgress";
import { isDevSim } from "@/lib/devSim";
import { haversineM } from "@/lib/geoUtils";
import { readSession } from "@/lib/session";
import { dbg } from "@/lib/debug";
import { useWakeLock } from "@/hooks/useWakeLock";
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
  const joinToken = useGameStore((s) => s.joinToken);
  const setSession = useGameStore((s) => s.setSession);
  const { status: gpsStatus, reading, start } = useGPS();

  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<string>("Loading match…");
  const [zoneCooldownSec, setZoneCooldownSec] = useState(0);
  const [rescuePending, setRescuePending] = useState(false);
  const [endedLocally, setEndedLocally] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const playersRef = useRef<Map<string, PlayerWorld>>(new Map());
  const broadcastTickRef = useRef<((t: WorldStateTick) => void) | null>(null);
  const broadcastActionRef = useRef<
    ((a: import("@/types/game").GameActionEvent) => void) | null
  >(null);
  const endingRef = useRef(false);
  const endReasonRef = useRef<EndReason>("HOST_ENDED");
  const lastTickAtRef = useRef(0);
  const restoreTickRef = useRef<WorldStateTick | null>(null);
  const lastProgressSaveRef = useRef(0);
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  snapshotRef.current = snapshot;
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  useWakeLock(!matchEnded && gpsStatus === "granted");

  useEffect(() => {
    void start();
    // hydrate prior match progress (refresh recovery)
    const prog = loadMatchProgress(roomCode);
    if (prog) {
      const s = useGameStore.getState();
      useGameStore.setState({
        distanceM: Math.max(s.distanceM, prog.distanceM),
        maxSpeedMs: Math.max(s.maxSpeedMs, prog.maxSpeedMs),
        knockdowns: Math.max(s.knockdowns, prog.knockdowns),
        gpsTrack: prog.gpsTrack.length > 0 ? prog.gpsTrack : s.gpsTrack,
      });
      if (prog.worldTick) {
        restoreTickRef.current = prog.worldTick;
        setWorldTick(prog.worldTick);
      }
    }
    void fetchRoomSnapshot(roomCode).then((snap) => {
      dbg("play snapshot", snap ? {
        status: snap.status,
        isHost: snap.host_player_id === useGameStore.getState().playerId,
        center: [snap.center_lng, snap.center_lat],
        players: snap.players.length,
      } : "null");
      setSnapshot(snap);
      if (!snap) setStatus("Room not found");
      else {
        useGameStore.getState().setRoom({
          roomCode: snap.room_code,
          isHost: snap.host_player_id === useGameStore.getState().playerId,
          roomId: snap.room_id,
        });
        // merge server-side stats (heartbeat) — keep the larger value
        const me = snap.players.find(
          (p) => p.player_id === useGameStore.getState().playerId
        );
        if (me) {
          const s = useGameStore.getState();
          useGameStore.setState({
            distanceM: Math.max(s.distanceM, me.distance_m ?? 0),
            maxSpeedMs: Math.max(s.maxSpeedMs, me.max_speed_ms ?? 0),
          });
        }
        if (snap.status === "ENDED") {
          setEndedLocally(true);
          setMatchEnded(true);
          clearMatchProgress();
        }
      }
    });
  }, [roomCode, start, setMatchEnded, setWorldTick]);

  // ensure join_token once (resume flow skips room page) — idempotent rejoin
  useEffect(() => {
    if (!playerId || joinToken) return;
    const s = useGameStore.getState();
    const lat = reading?.lat ?? 16.054407;
    const lng = reading?.lng ?? 108.202167;
    void (async () => {
      try {
        const body = (pid: string, token: string | null) =>
          JSON.stringify({
            room_code: roomCode,
            nickname: s.nickname?.trim() || readSession().nickname || "Survivor",
            player_id: pid,
            lat,
            lng,
            join_token: token,
          });
        let res = await fetch("/api/rooms/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body(playerId, s.joinToken),
        });
        let pid = playerId;
        if (res.status === 403) {
          pid = crypto.randomUUID();
          res = await fetch("/api/rooms/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body(pid, null),
          });
        }
        if (!res.ok) return;
        const d = (await res.json()) as { join_token?: string; is_host?: boolean; room_id?: string };
        if (d.join_token) {
          setSession({
            playerId: pid,
            nickname: s.nickname || readSession().nickname || "Survivor",
            joinToken: d.join_token,
          });
          useGameStore.getState().setRoom({
            roomCode,
            isHost: Boolean(d.is_host),
            roomId: d.room_id ?? null,
          });
        }
      } catch {
        /* retry next joinToken change */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, joinToken, roomCode, setSession]);

  useEffect(() => {
    if (reading) {
      setSelfPos({ lat: reading.lat, lng: reading.lng });
      recordGps({ lat: reading.lat, lng: reading.lng }, reading.speed_ms);
    }
  }, [reading, setSelfPos, recordGps]);

  const persistProgress = useCallback(
    (tick: WorldStateTick | null, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressSaveRef.current < 2000) return;
      lastProgressSaveRef.current = now;
      const s = useGameStore.getState();
      const rid = snapshotRef.current?.room_id ?? s.roomId;
      saveMatchProgress({
        roomCode,
        roomId: rid,
        distanceM: s.distanceM,
        maxSpeedMs: s.maxSpeedMs,
        knockdowns: s.knockdowns,
        gpsTrack: s.gpsTrack,
        worldTick: tick ?? useGameStore.getState().worldTick,
      });
    },
    [roomCode]
  );

  const onTick = useCallback(
    (tick: WorldStateTick) => {
      // drop forged ticks — only the current host may author the world
      const host = snapshotRef.current?.host_player_id;
      if (!host || tick.host_player_id !== host) return;
      if (tick.tick_id % 10 === 1) dbg("client onTick", tick.tick_id, `t+${tick.elapsed_sec}s`);
      lastTickAtRef.current = Date.now();
      setWorldTick(tick);
      persistProgress(tick);
    },
    [setWorldTick, persistProgress]
  );

  // flush progress on tab hide / unload
  useEffect(() => {
    const flush = () => persistProgress(null, true);
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [persistProgress]);

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
            join_token: useGameStore.getState().joinToken,
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
        clearMatchProgress();
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
            join_token: useGameStore.getState().joinToken,
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
    onLobby: () => {
      void fetchRoomSnapshot(roomCode).then((snap) => {
        if (snap) setSnapshot(snap);
      });
    },
    onAction: (action) => {
      // forge guard: host-authoritative actions must come from the host
      const snapHost = snapshotRef.current?.host_player_id;
      const actor = action.actor_player_id;
      if (action.action === "MATCH_ENDED") {
        if (action.data.end_reason === "HOST_ENDED" && actor !== snapHost) return;
        if (action.data.end_reason === "ALL_KNOCKED") {
          const t = useGameStore.getState().worldTick;
          if (t && t.players.length > 0 && !t.players.every((p) => p.state === "KNOCKED")) return;
        }
      } else if (action.action === "SPAWN_SAFE_ZONE" || action.action === "REMATCH") {
        if (!snapHost || actor !== snapHost) return;
      }
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
        clearMatchProgress();
        workerRef.current?.postMessage({ type: "stop" } satisfies WorkerIn);
      } else if (action.action === "HOST_MIGRATED") {
        const newHost = action.data.new_host_player_id as string | undefined;
        if (newHost && snapshotRef.current && snapshotRef.current.host_player_id !== newHost) {
          // keep the tick forge-guard's host reference current
          setSnapshot({ ...snapshotRef.current, host_player_id: newHost });
        }
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
        restoreTickRef.current = null;
        clearMatchProgress();
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
      dbg("host: loading graph at", center);
      const graphResult = await loadRoadGraph(center);
      if (cancelled) return;
      const mode: PathfindingMode = graphResult.mode;
      dbg("host: graph done", {
        mode,
        nodes: graphResult.graph?.nodes.size ?? 0,
      });
       setPathfinding(mode, null);

      const worker = new Worker(new URL("../../../../engine/roomTick.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      setWorkerReady(true);
      dbg("host: worker created");
      worker.onerror = (e) => dbg("host: worker ERROR", e.message ?? e);
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const msg = ev.data;
        if (msg.type === "ready") {
          dbg("host: worker ready", { zombies: msg.zombieCount, mode: msg.mode });
          setStatus("Live");
        } else if (msg.type === "tick") {
          if (msg.payload.tick_id % 10 === 1) {
            dbg("host: tick", msg.payload.tick_id, `t+${msg.payload.elapsed_sec}s`, `zombies=${msg.payload.zombies.length}`);
          }
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
          broadcastTickRef.current?.({ ...msg.payload, host_player_id: playerIdRef.current ?? undefined });
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
        } else if (msg.type === "quest_complete") {
          setStatus(`Quest complete · +${msg.bonus_m}m bonus`);
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
      setWorkerReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, snapshot?.status, snapshot?.room_id, endedLocally, matchEnded]);

  useEffect(() => {
    if (!isHost && worldTick) {
      setStatus(`Live · tick ${worldTick.tick_id}`);
    }
  }, [isHost, worldTick]);

  // background graph upgrade: initial load fell back to free-move — retry OSM API every 30 s
  useEffect(() => {
    if (!isHost || !workerReady || !workerRef.current) return;
    if (pathfindingMode !== "DIRECT_VECTOR_FALLBACK") return;
    if (endedLocally || matchEnded) return;
    const snapshot = snapshotRef.current;
    const center = {
      lat: snapshot?.center_lat ?? reading?.lat ?? 16.054407,
      lng: snapshot?.center_lng ?? reading?.lng ?? 108.202167,
    };
    const timer = setInterval(() => {
      void (async () => {
        const r = await loadRoadGraph(center);
        if (r.mode !== "GRAPH_ASTAR" || !r.graph) return;
        workerRef.current?.postMessage({ type: "set_graph", graph: r.graph, mode: r.mode } satisfies WorkerIn);
        setPathfinding("GRAPH_ASTAR", null);
        setStatus("Road graph ready · zombies follow roads");
        dbg("background graph upgrade", { nodes: r.graph.nodes.size });
        clearInterval(timer);
      })();
    }, 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, workerReady, pathfindingMode, endedLocally, matchEnded]);

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
          join_token: joinToken,
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
  }, [snapshot, selfPos, worldTick, playerId, joinToken]);

  const onRescue = useCallback(
    async (victimId: string, holdElapsedMs: number) => {
      if (!playerId || rescuePending) return;
      const me = worldTick?.players.find((p) => p.player_id === playerId);
      if (!me) return;
      setRescuePending(true);
      try {
        const res = await fetch("/api/rescue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: snapshot?.room_id ?? useGameStore.getState().roomId,
            rescuer_id: playerId,
            victim_id: victimId,
            join_token: useGameStore.getState().joinToken,
            rescuer_lat: me.lat,
            rescuer_lng: me.lng,
            hold_elapsed_ms: holdElapsedMs,
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
    [playerId, worldTick, rescuePending, isHost, snapshot?.room_id]
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
    if (isHost || matchEnded || !snapshot?.room_id || !playerId || !joinToken) return;
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
          join_token: joinToken,
        }),
      }).catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [isHost, matchEnded, snapshot?.room_id, playerId, joinToken]);

  // host: sweep silent players → DISCONNECTED so ghosts stop + end conditions work
  useEffect(() => {
    if (!isHost || matchEnded || !snapshot?.room_id || !playerId || !joinToken) return;
    const id = window.setInterval(() => {
      void fetch("/api/rooms/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: snapshot.room_id,
          requester_player_id: playerId,
          join_token: joinToken,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const ids: string[] = d?.disconnected ?? [];
          if (!ids.length) return;
          let changed = false;
          for (const gone of ids) {
            const w = playersRef.current.get(gone);
            if (w && w.state !== "DISCONNECTED") {
              w.state = "DISCONNECTED";
              changed = true;
            }
          }
          if (changed) {
            workerRef.current?.postMessage({
              type: "players",
              players: [...playersRef.current.values()],
            } satisfies WorkerIn);
          }
        })
        .catch(() => {});
    }, 10_000);
    return () => window.clearInterval(id);
  }, [isHost, matchEnded, snapshot?.room_id, playerId, joinToken]);

  // dev-only force knock for e2e
  useEffect(() => {
    if (!isDevSim()) return;
    const w = window as unknown as {
      __outbreak?: { forceKnock: (id?: string) => void };
    };
    w.__outbreak = {
      forceKnock: (id) => {
        const pid = id ?? useGameStore.getState().playerId;
        if (!pid) return;
        let p = playersRef.current.get(pid);
        if (!p) {
          // knock before snapshot seed — dev hook must not no-op
          const snap = snapshotRef.current;
          p = {
            player_id: pid,
            nickname: "dev",
            state: "ALIVE",
            hp: 100,
            max_hp: 100,
            lat: snap?.center_lat ?? 16.054407,
            lng: snap?.center_lng ?? 108.202167,
            noise: 0.05,
            in_safe_zone: false,
            knocked_remaining_sec: null,
          };
          playersRef.current.set(pid, p);
        }
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

  const loading = !snapshot || snapshot.status !== "ACTIVE" || !workerReady;
  if (loading && !matchEnded) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-text">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-safe border-t-transparent" />
        <p className="text-sm text-muted">{status || "Loading…"}</p>
      </main>
    );
  }
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

  const gpsOk = gpsStatus === "granted";
  if (!gpsOk) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
        <h1 className="text-xl font-bold tracking-widest text-safe">OUTBREAK</h1>
        <p className="text-sm text-text">
          {gpsStatus === "denied"
            ? "Location access denied. Enable GPS for this site in browser settings, then reload."
            : gpsStatus === "unavailable"
              ? "GPS unavailable on this device."
              : "Allow location access to play."}
        </p>
        {gpsStatus !== "denied" && gpsStatus !== "unavailable" && (
          <button
            data-testid="allow-gps"
            onClick={() => start()}
            className="rounded bg-safe px-4 py-3 text-base font-bold text-bg"
          >
            Allow GPS
          </button>
        )}
        {gpsStatus === "requesting" && (
          <p className="text-sm text-muted">Waiting for browser permission…</p>
        )}
      </main>
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
          quest={worldTick?.quest ?? null}
        />
        <SurvivalHUD
          tick={worldTick}
          playerId={playerId}
          isHost={isHost}
          nickname={nickname}
          onCreateZone={() => void onCreateZone()}
          zoneCooldownSec={zoneCooldownSec}
          onEndMatch={onEndMatch}
          onRescue={onRescue}
          rescuePending={rescuePending}
          statusLine={status}
        />
      </div>

      <footer className="z-10 border-t border-line bg-bg/90 px-3 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">{status}</span>
        </div>
        {graphNotice && <p className="mt-1 text-warn">{graphNotice}</p>}
        <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted">
          <span>zombies {worldTick?.zombies.length ?? 0}</span>
          <span>safe zones {worldTick?.safe_zones.length ?? 0}</span>
          <span>{Math.round(distanceM)}m walked</span>
          <span>{knockdowns} knocks</span>
          {worldTick?.quest?.status === "ACTIVE" && (
            <span className="text-safe">
              quest {Math.round(haversineM(
                selfPos ?? { lat: 0, lng: 0 },
                { lat: worldTick.quest.target_lat, lng: worldTick.quest.target_lng }
              ))}m · {Math.max(0, Math.ceil((worldTick.quest.deadline_ms - Date.now()) / 1000))}s
            </span>
          )}
        </div>
        {!isHost && !worldTick && (
          <p className="mt-1 text-muted">Waiting for host tick…</p>
        )}
      </footer>
    </main>
  );
}

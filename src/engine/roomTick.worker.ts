import { haversineM, bearingDeg } from "@/lib/geoUtils";
import { findNearestGraphNode, type PathfindingMode, type RoadGraph } from "@/engine/osmGraph";
import { findPath, needsRepath, MAX_ITERATIONS } from "@/engine/astar";
import {
  ZOMBIE_PARAMS,
  detectRadius,
  transition,
  emitsSwarm,
  SEARCH_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  SWARM_RADIUS_M,
  type FsmContext,
  type TargetIssue,
} from "@/engine/zombieFSM";
import {
  KNOCK_SEC,
  onKnockTimeout,
  shouldEndAllKnocked,
  shouldEndSolo,
  zoneHeal,
} from "@/engine/survivalRules";
import { restoreFromTick } from "@/engine/workerRestore";
import { dbg } from "@/lib/debug";
import type {
  EndReason,
  PlayerState,
  SafeZoneTick,
  WorldStateTick,
  ZombieState,
  ZombieTick,
  ZombieType,
} from "@/types/game";

export interface PlayerWorld {
  player_id: string;
  nickname: string;
  state: PlayerState;
  hp: number;
  max_hp: number;
  lat: number;
  lng: number;
  noise: number;
  in_safe_zone: boolean;
  knocked_remaining_sec: number | null;
}

export interface ZombieWorld {
  id: string;
  type: ZombieType;
  state: ZombieState;
  lat: number;
  lng: number;
  heading_deg: number;
  target_player_id: string | null;
  path: string[];
  pathIndex: number;
  goal: { lat: number; lng: number } | null;
  stateEnteredAt: number;
  lastPathAt: number;
  needsPath: boolean;
  pendingStart?: string;
  pendingGoal?: string;
}

export type Density = "LOW" | "MEDIUM" | "HIGH";

export type WorkerIn =
  | {
      type: "init";
      graph: RoadGraph | null;
      mode: PathfindingMode;
      center: { lat: number; lng: number };
      players: PlayerWorld[];
      density: Density;
      startedAt: number;
      hostZones?: SafeZoneTick[];
      restoreTick?: WorldStateTick;
    }
  | { type: "players"; players: PlayerWorld[] }
  | { type: "set_graph"; graph: RoadGraph | null; mode: PathfindingMode }
  | { type: "add_zone"; zone: SafeZoneTick }
  | { type: "apply_rescue"; rescuerId: string; victimId: string }
  | { type: "stop" };

export type WorkerOut =
  | { type: "ready"; mode: PathfindingMode; zombieCount: number }
  | { type: "tick"; payload: WorldStateTick }
  | { type: "slow_tick"; ms: number }
  | {
      type: "player_knocked";
      player_id: string;
      remaining_sec: number;
      solo: boolean;
    }
  | {
      type: "auto_respawn";
      player_id: string;
      new_max_hp: number;
      zone_id: string | null;
    }
  | { type: "match_end"; reason: EndReason }
  | { type: "quest_complete"; bonus_m: number };

const TICK_MS = 1000;
const ASTAR_BUDGET_PER_TICK = 5;
const TICK_BUDGET_MS = 15;
const DENSITY_COUNT: Record<Density, number> = { LOW: 5, MEDIUM: 10, HIGH: 15 };
const ZOMBIE_TYPES: ZombieType[] = ["WALKER", "RUNNER", "STALKER", "SCREAMER", "BRUTE"];
const SPAWN_MIN_M = 80;
const ZONE_MIN_M = 150;
const ZONE_MAX_M = 300;

let graph: RoadGraph | null = null;
let mode: PathfindingMode = "DIRECT_VECTOR_FALLBACK";
let center = { lat: 0, lng: 0 };
let players: PlayerWorld[] = [];
let zombies: ZombieWorld[] = [];
let zones: SafeZoneTick[] = [];
let startedAt = 0;
let tickId = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let pathQueue: string[] = [];
let swarmCall: { lat: number; lng: number; at: number } | null = null;
let ended = false;
const knockedNotified = new Set<string>();
const respawnNotified = new Set<string>();

let lastWaveAt = 0;
let waveCount = 0;
let quest: { targetLat: number; targetLng: number; startedAt: number; deadline: number; status: "ACTIVE" | "COMPLETE" | "FAILED"; bonusM: number } | null = null;
let zombieCap = DENSITY_COUNT.MEDIUM * 3;

/** quest/wave anchor: first ALIVE player — players[0] may be knocked or gone */
function aliveAnchor(): PlayerWorld | null {
  return players.find((p) => p.state === "ALIVE") ?? null;
}

function newQuest(): void {
  const p = aliveAnchor();
  if (!p) {
    // everyone down — retry once someone is alive
    setTimeout(() => {
      if (!ended) newQuest();
    }, 3000);
    return;
  }
  const dist = 200 + Math.random() * 300;
  const ang = Math.random() * Math.PI * 2;
  quest = {
    targetLat: p.lat + (dist * Math.cos(ang)) / 111_320,
    targetLng: p.lng + (dist * Math.sin(ang)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
    startedAt: Date.now(),
    deadline: Date.now() + 90000,
    status: "ACTIVE",
    bonusM: dist,
  };
  lastWaveAt = Date.now();
  waveCount = 0;
}

function spawnCluster(lat: number, lng: number, count: number, typeOverride?: ZombieType): void {
  const room = zombieCap - zombies.length;
  if (room <= 0) return;
  const n = Math.min(count, room);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 5 + Math.random() * 15;
    const zLat = lat + (r * Math.cos(ang)) / 111_320;
    const zLng = lng + (r * Math.sin(ang)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    const type = typeOverride ?? (ZOMBIE_TYPES[Math.floor(Math.random() * 3)] as ZombieType);
    zombies.push(newZombie(`z_${Date.now()}_${i}`, type, zLat, zLng));
  }
}

function spawnZombies(): void {
  zombies = [];
  lastWaveAt = Date.now();
  waveCount = 0;
  const p = aliveAnchor();
  const baseLat = p ? p.lat : center.lat;
  const baseLng = p ? p.lng : center.lng;
  // spawn 3 in a cluster 80m ahead of player
  const aheadLat = baseLat + (80 / 111_320);
  const aheadLng = baseLng;
  spawnCluster(aheadLat, aheadLng, 3, "WALKER");
}

function newZombie(id: string, type: ZombieType, lat: number, lng: number): ZombieWorld {
  return {
    id,
    type,
    state: "IDLE",
    lat,
    lng,
    heading_deg: 0,
    target_player_id: null,
    path: [],
    pathIndex: 0,
    goal: null,
    stateEnteredAt: Date.now(),
    lastPathAt: 0,
    needsPath: false,
  };
}

function spawnSafeZones(): void {
  zones = [];
  const pts: Array<{ lat: number; lng: number }> = [];
  if (graph && graph.nodes.size > 0) {
    const nodes = [...graph.nodes.values()];
    for (const n of nodes) {
      const d = haversineM(center, n);
      if (d >= ZONE_MIN_M && d <= ZONE_MAX_M) pts.push(n);
      if (pts.length >= 2) break;
    }
    if (pts.length < 2) {
      for (const n of nodes) {
        if (haversineM(center, n) >= 40) {
          pts.push(n);
          if (pts.length >= 2) break;
        }
      }
    }
  }
  while (pts.length < 2) {
    const ang = pts.length === 0 ? 0 : Math.PI;
    const lat = center.lat + (200 * Math.cos(ang)) / 111_320;
    const lng =
      center.lng + (200 * Math.sin(ang)) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
    pts.push({ lat, lng });
  }
  zones = pts.slice(0, 2).map((p, i) => ({
    id: `sz_${i}`,
    zone_type: "SYSTEM" as const,
    lat: p.lat,
    lng: p.lng,
    radius_m: 30,
    expires_in_sec: null,
  }));
}

function nearestAlivePlayer(
  z: ZombieWorld,
  rDetect: number
): { p: PlayerWorld; dist: number } | null {
  let best: { p: PlayerWorld; dist: number } | null = null;
  for (const p of players) {
    if (p.state !== "ALIVE") continue;
    const d = haversineM(z, p);
    if (d <= rDetect && (!best || d < best.dist)) best = { p, dist: d };
  }
  return best;
}

function targetIssueFor(p: PlayerWorld, dist: number, rDetect: number): TargetIssue {
  if (p.state === "KNOCKED" || p.state === "DISCONNECTED") return "KNOCKED_OR_DC";
  if (p.in_safe_zone) return "SAFE_ZONE";
  if (dist > rDetect) return "OUT_OF_RANGE";
  return "NONE";
}

function noiseSpike(z: ZombieWorld, p: PlayerWorld, rDetect: number): boolean {
  const d = haversineM(z, p);
  return d > rDetect && d <= rDetect * 1.4;
}

function requestPath(z: ZombieWorld, goalLat: number, goalLng: number): void {
  if (!graph) return;
  const goalNode = findNearestGraphNode(graph, { lat: goalLat, lng: lngSafe(goalLng) });
  const startNode = findNearestGraphNode(graph, z);
  if (!goalNode || !startNode) return;
  const prevGoal = z.goal;
  const entered =
    z.state === "CHASE" || z.state === "INVESTIGATE" || z.state === "SWARM";
  if (
    !needsRepath(prevGoal, { lat: goalLat, lng: goalLng }, z.path.length === 0, entered) &&
    z.path.length > 0
  ) {
    return;
  }
  z.goal = { lat: goalLat, lng: goalLng };
  z.pendingStart = startNode;
  z.pendingGoal = goalNode;
  if (!pathQueue.includes(z.id)) pathQueue.push(z.id);
}

function lngSafe(lng: number): number {
  return lng;
}

function runAstarQueue(budget: number): void {
  if (!graph) {
    pathQueue = [];
    return;
  }
  let n = 0;
  while (pathQueue.length > 0 && n < budget) {
    const id = pathQueue.shift()!;
    const z = zombies.find((x) => x.id === id);
    if (!z || !z.pendingStart || !z.pendingGoal) continue;
    const t0 = performance.now();
    const path = findPath(graph, z.pendingStart, z.pendingGoal);
    const ms = performance.now() - t0;
    if (ms > MAX_ITERATIONS) {
      /* iteration cap already in findPath */
    }
    z.path = path;
    z.pathIndex = 0;
    z.lastPathAt = Date.now();
    z.needsPath = false;
    z.pendingStart = undefined;
    z.pendingGoal = undefined;
    n++;
  }
}

function stepAlongPath(z: ZombieWorld, speed: number, dt: number): void {
  if (!graph || z.path.length === 0) {
    // free-move toward goal
    if (z.goal) {
      moveToward(z, z.goal, speed, dt);
    }
    return;
  }
  let remaining = speed * dt;
  while (remaining > 0 && z.pathIndex < z.path.length - 1) {
    const fromId = z.path[z.pathIndex] as string;
    const toId = z.path[z.pathIndex + 1] as string;
    const a = graph.nodes.get(fromId);
    const b = graph.nodes.get(toId);
    if (!a || !b) {
      z.pathIndex++;
      continue;
    }
    const seg = haversineM(a, b);
    const dToB = haversineM(z, b);
    if (seg <= 0.001) {
      z.pathIndex++;
      continue;
    }
    if (remaining >= dToB) {
      remaining -= dToB;
      z.lat = b.lat;
      z.lng = b.lng;
      z.heading_deg = bearingDeg(a, b);
      z.pathIndex++;
    } else {
      const t = remaining / Math.max(dToB, 0.001);
      z.lat = z.lat + (b.lat - z.lat) * t;
      z.lng = z.lng + (b.lng - z.lng) * t;
      z.heading_deg = bearingDeg(a, b);
      remaining = 0;
    }
  }
}

function moveToward(
  z: { lat: number; lng: number; heading_deg: number },
  goal: { lat: number; lng: number },
  speed: number,
  dt: number
): void {
  const d = haversineM(z, goal);
  if (d < 0.5) return;
  const step = Math.min(d, speed * dt);
  const t = step / d;
  z.heading_deg = bearingDeg(z, goal);
  z.lat = z.lat + (goal.lat - z.lat) * t;
  z.lng = z.lng + (goal.lng - z.lng) * t;
}

function pickWanderGoal(z: ZombieWorld): void {
  if (!graph) {
    const ang = Math.random() * Math.PI * 2;
    z.goal = {
      lat: z.lat + (20 * Math.cos(ang)) / 111_320,
      lng: z.lng + (20 * Math.sin(ang)) / 111_320,
    };
    z.needsPath = true;
    return;
  }
  const nodeId = findNearestGraphNode(graph, z);
  if (!nodeId) return;
  const edges = graph.edges.get(nodeId) ?? [];
  const edge =
    edges.length > 0 ? edges[Math.floor(Math.random() * edges.length)] : undefined;
  const next = edge ? edge.to : nodeId;
  const n = graph.nodes.get(next);
  if (!n) return;
  z.goal = { lat: n.lat, lng: n.lng };
  z.needsPath = true;
}

function nearestZone(p: { lat: number; lng: number }): SafeZoneTick | null {
  let best: SafeZoneTick | null = null;
  let bestD = Infinity;
  for (const z of zones) {
    if (z.expires_in_sec != null && z.expires_in_sec <= 0) continue;
    const d = haversineM(p, z);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

function tick(): void {
  if (ended) return;
  const t0 = performance.now();
  const dt = 1.0;
  const now = Date.now();

  // expire host zones
  for (const z of zones) {
    if (z.expires_in_sec != null) z.expires_in_sec = Math.max(0, z.expires_in_sec - dt);
  }
  zones = zones.filter((z) => z.expires_in_sec == null || z.expires_in_sec > 0);

  // despawn zombies far from all players
  zombies = zombies.filter((z) => players.some((p) => haversineM(z, p) <= 1000));
  // idle zombies drift back toward nearest player
  for (const z of zombies) {
    if (z.state === "WANDER" || z.state === "IDLE") {
      const near = players.find((p) => p.state === "ALIVE");
      if (near) {
        const d = haversineM(z, near);
        if (d > 200) {
          z.goal = { lat: near.lat, lng: near.lng };
          z.needsPath = true;
        }
      }
    }
  }
  // wave spawn every 60s
  if (now - lastWaveAt >= 60000 && players.length > 0) {
    lastWaveAt = now;
    waveCount++;
    const p = aliveAnchor();
    if (p) {
      const type: ZombieType =
        waveCount <= 2 ? "WALKER" : waveCount <= 4 ? "RUNNER" : waveCount <= 6 ? "STALKER" : "SCREAMER";
      const count = waveCount <= 2 ? 2 : 3;
      const aheadLat = p.lat + (70 / 111_320);
      const aheadLng = p.lng;
      spawnCluster(aheadLat, aheadLng, count, type);
    }
  }

  // quest completion check
  if (quest && quest.status === "ACTIVE") {
    const p = aliveAnchor();
    if (p) {
      const d = haversineM({ lat: p.lat, lng: p.lng }, { lat: quest.targetLat, lng: quest.targetLng });
      if (d <= 15) {
        quest.status = "COMPLETE";
        postMessage({ type: "quest_complete", bonus_m: quest.bonusM } satisfies WorkerOut);
        setTimeout(() => newQuest(), 3000);
      } else if (now > quest.deadline) {
        quest.status = "FAILED";
        // increase zombie count next wave
        waveCount += 2;
        setTimeout(() => newQuest(), 3000);
      }
    }
  }

  // safe-zone flags, heal, knock timer / auto-respawn
  for (const p of players) {
    p.in_safe_zone = zones.some(
      (z) => haversineM(p, z) <= z.radius_m && (z.expires_in_sec == null || z.expires_in_sec > 0)
    );
    if (p.in_safe_zone && p.state === "ALIVE") {
      p.hp = zoneHeal(p.hp, p.max_hp, dt);
    }
    if (p.state === "KNOCKED" && p.knocked_remaining_sec != null) {
      p.knocked_remaining_sec = Math.max(0, p.knocked_remaining_sec - dt);
      if (p.knocked_remaining_sec <= 0 && !respawnNotified.has(p.player_id)) {
        // solo → end handled below; otherwise penalty respawn at nearest zone
        if (players.length === 1) {
          /* match_end path */
        } else {
          const { maxHp, hp } = onKnockTimeout(p.max_hp);
          p.max_hp = maxHp;
          p.hp = hp;
          p.state = "ALIVE";
          p.knocked_remaining_sec = null;
          const z = nearestZone(p);
          if (z) {
            p.lat = z.lat;
            p.lng = z.lng;
          }
          respawnNotified.add(p.player_id);
          knockedNotified.delete(p.player_id);
          postMessage({
            type: "auto_respawn",
            player_id: p.player_id,
            new_max_hp: maxHp,
            zone_id: z?.id ?? null,
          } satisfies WorkerOut);
        }
      }
    }
    if (p.state === "KNOCKED" && !knockedNotified.has(p.player_id)) {
      knockedNotified.add(p.player_id);
      postMessage({
        type: "player_knocked",
        player_id: p.player_id,
        remaining_sec: p.knocked_remaining_sec ?? KNOCK_SEC,
        solo: players.length === 1,
      } satisfies WorkerOut);
    }
  }

  // screamer swarm emit
  swarmCall = null;
  for (const z of zombies) {
    if (z.type !== "SCREAMER") continue;
    if (z.target_player_id && z.state === "CHASE") {
      swarmCall = { lat: z.lat, lng: z.lng, at: now };
      break;
    }
  }

  for (const z of zombies) {
    const params = ZOMBIE_PARAMS[z.type];
    const rDetect = detectRadius(params.rBase, Math.max(...players.map((p) => p.noise), 0.05));

    let target: PlayerWorld | null = null;
    let dist = Infinity;
    if (z.target_player_id) {
      const cur = players.find((p) => p.player_id === z.target_player_id);
      if (cur) {
        dist = haversineM(z, cur);
        target = cur;
      }
    }
    if (!target || dist > rDetect * 1.4) {
      const near = nearestAlivePlayer(z, rDetect * 1.4);
      if (near) {
        target = near.p;
        dist = near.dist;
        z.target_player_id = near.p.player_id;
      } else if (target && dist > rDetect * 1.4) {
        z.target_player_id = null;
        target = null;
        dist = Infinity;
      }
    }

    const hasTarget = Boolean(target);
    const issue: TargetIssue = target
      ? targetIssueFor(target, dist, rDetect)
      : "NO_TARGET";
    const swarmActive =
      swarmCall != null &&
      haversineM(z, swarmCall) <= SWARM_RADIUS_M &&
      z.type !== "SCREAMER" &&
      (z.state === "WANDER" || z.state === "INVESTIGATE" || z.state === "SWARM");

    let spike = false;
    if (target && issue === "NONE" && dist > rDetect) {
      spike = noiseSpike(z, target, rDetect);
    }

    const searchExpired =
      (z.state === "SEARCH" || z.state === "INVESTIGATE" || z.state === "SWARM") &&
      now - z.stateEnteredAt >= SEARCH_TIMEOUT_MS;
    const idleExpired = z.state === "IDLE" && now - z.stateEnteredAt >= IDLE_TIMEOUT_MS;

    const ctx: FsmContext = {
      state: z.state,
      dist,
      rDetect,
      hasTarget,
      targetIssue: issue,
      swarmCall: swarmActive,
      noiseSpike: spike,
      searchExpired,
      idleExpired,
    };

    const prevState = z.state;
    const next = transition(ctx);
    if (next !== prevState) {
      z.state = next;
      z.stateEnteredAt = now;
      if (emitsSwarm(z.type, prevState, next)) {
        swarmCall = { lat: z.lat, lng: z.lng, at: now };
      }
      if (next === "CHASE" || next === "INVESTIGATE" || next === "SWARM" || next === "SEARCH") {
        z.needsPath = true;
      }
      if (next === "WANDER" || next === "IDLE") {
        z.target_player_id = next === "WANDER" ? z.target_player_id : null;
        if (next === "WANDER") pickWanderGoal(z);
      }
      if (next === "SEARCH" && target && issue !== "NONE") {
        z.goal = { lat: target.lat, lng: target.lng };
        z.needsPath = true;
      }
    }

    // path requests
    if (z.needsPath || z.path.length === 0) {
      if (z.state === "CHASE" || z.state === "ATTACK") {
        if (target) requestPath(z, target.lat, target.lng);
      } else if (z.state === "SWARM" && swarmCall) {
        requestPath(z, swarmCall.lat, swarmCall.lng);
      } else if (z.state === "INVESTIGATE" && target) {
        requestPath(z, target.lat, target.lng);
      } else if (z.state === "WANDER" && z.goal) {
        requestPath(z, z.goal.lat, z.goal.lng);
      }
      if (z.path.length > 0) z.needsPath = false;
    }

    // movement
    const speed =
      z.state === "CHASE" || z.state === "ATTACK"
        ? params.chaseSpeed
        : z.state === "IDLE"
          ? 0
          : params.wanderSpeed;
    if (z.state === "ATTACK" && target) {
      // hold melee range
      if (dist > 3.5) stepAlongPath(z, params.chaseSpeed, dt);
    } else if (z.state === "SWARM" && swarmCall) {
      if (!graph) moveToward(z, swarmCall, speed, dt);
      else stepAlongPath(z, speed, dt);
    } else {
      stepAlongPath(z, speed, dt);
    }

    // attack damage
    if (z.state === "ATTACK" && target && issue === "NONE" && dist <= 3.5 && !target.in_safe_zone) {
      target.hp = Math.max(0, target.hp - params.dps * dt);
      if (target.hp <= 0 && target.state === "ALIVE") {
        target.state = "KNOCKED";
        target.knocked_remaining_sec = KNOCK_SEC;
        z.target_player_id = null;
        z.state = "WANDER";
        z.stateEnteredAt = now;
        pickWanderGoal(z);
      }
    }
  }

  runAstarQueue(ASTAR_BUDGET_PER_TICK);

  // end conditions
  if (shouldEndSolo(players.length, players[0]?.state ?? "ALIVE")) {
    ended = true;
    stop();
    postMessage({ type: "match_end", reason: "ALL_KNOCKED" } satisfies WorkerOut);
    return;
  }
  if (players.length > 1 && shouldEndAllKnocked(players)) {
    ended = true;
    stop();
    postMessage({ type: "match_end", reason: "ALL_KNOCKED" } satisfies WorkerOut);
    return;
  }

  const elapsed = Math.floor((now - startedAt) / 1000);
  const payload: WorldStateTick = {
    tick_id: ++tickId,
    elapsed_sec: elapsed,
    pathfinding_mode: mode,
    players: players.map((p) => ({ ...p })),
    zombies: zombies.map(
      (z): ZombieTick => ({
        id: z.id,
        type: z.type,
        state: z.state,
        lat: z.lat,
        lng: z.lng,
        heading_deg: z.heading_deg,
        target_player_id: z.target_player_id,
      })
    ),
    safe_zones: zones.map((z) => ({ ...z })),
    quest: quest
      ? {
          target_lat: quest.targetLat,
          target_lng: quest.targetLng,
          started_at_ms: quest.startedAt,
          deadline_ms: quest.deadline,
          status: quest.status,
          bonus_m: quest.bonusM,
        }
      : null,
  };

  const ms = performance.now() - t0;
  if (tickId % 10 === 1) {
    dbg("worker tick", tickId, `t+${elapsed}s`, `${ms.toFixed(1)}ms`, `zombies=${payload.zombies.length}`);
  }
  if (ms > TICK_BUDGET_MS) {
    postMessage({ type: "slow_tick", ms } satisfies WorkerOut);
  }
  postMessage({ type: "tick", payload } satisfies WorkerOut);
}

function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    dbg("worker init", {
      players: msg.players.length,
      mode: msg.mode,
      nodes: msg.graph?.nodes.size ?? 0,
      restore: Boolean(msg.restoreTick),
    });
    stop();
    graph = msg.graph;
    mode = msg.mode;
    center = msg.center;
    pathQueue = [];
    swarmCall = null;
    ended = false;
    zombieCap = DENSITY_COUNT[msg.density] * 3;
    knockedNotified.clear();
    respawnNotified.clear();
      if (msg.restoreTick) {
      const restored = restoreFromTick(msg.restoreTick);
      players = restored.players;
      zombies = restored.zombies;
      zones = restored.zones;
      startedAt = restored.startedAt;
      tickId = restored.tickId;
      if (msg.restoreTick.quest) {
        const q = msg.restoreTick.quest;
        quest = { targetLat: q.target_lat, targetLng: q.target_lng, startedAt: q.started_at_ms, deadline: q.deadline_ms, status: q.status, bonusM: q.bonus_m };
      } else {
        newQuest();
      }
    } else {
      players = msg.players.map((p) => ({ ...p }));
      startedAt = msg.startedAt;
      tickId = 0;
      spawnZombies();
      spawnSafeZones();
      newQuest();
      if (msg.hostZones?.length) {
        zones = [...zones, ...msg.hostZones.map((z) => ({ ...z }))];
      }
    }
    postMessage({
      type: "ready",
      mode,
      zombieCount: zombies.length,
    } satisfies WorkerOut);
    timer = setInterval(tick, TICK_MS);
  } else if (msg.type === "players") {
    players = msg.players.map((p) => ({ ...p }));
  } else if (msg.type === "set_graph") {
    dbg("worker set_graph", { mode: msg.mode, nodes: msg.graph?.nodes.size ?? 0 });
    graph = msg.graph;
    mode = msg.mode;
    pathQueue = [];
  } else if (msg.type === "add_zone") {
    if (!zones.some((z) => z.id === msg.zone.id)) {
      zones.push({ ...msg.zone });
    }
  } else if (msg.type === "apply_rescue") {
    const victim = players.find((p) => p.player_id === msg.victimId);
    if (victim && victim.state === "KNOCKED") {
      victim.state = "ALIVE";
      victim.hp = 50;
      victim.knocked_remaining_sec = null;
      knockedNotified.delete(victim.player_id);
      respawnNotified.delete(victim.player_id);
    }
  } else if (msg.type === "stop") {
    stop();
  }
};

export {};

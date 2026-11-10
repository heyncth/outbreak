# 06 · TECHNICAL DESIGN DOCUMENT (TDD) (v2.0)

## 1. System architecture

**Host-authoritative room tick** + **Supabase Realtime Broadcast**:

1. **Clients:** GPS → 5-stage filter → `player_telemetry` ≤ 1 Hz to channel `room:{room_code}`.
2. **Host Web Worker:** Runs AI tick every **1000 ms**, validates/applies movement, computes zombies/HP/zones, broadcasts `world_state_tick`.
3. **Next API / RPC:** Create, join (capacity), end, rematch, rescue, safe-zone insert — short-lived only.
4. **Host migration:** Host heartbeat lost > **15 s** → promote next ALIVE earliest joiner; worker restarts from last snapshot.

Edge functions are **not** the primary tick (stateless / timeout).

---

## 2. Road graph (Overpass → G(V,E))

### 2.1 Query (once per match Start)

```overpassql
[out:json][timeout:15];
(
way["highway"~"^(footway|pedestrian|residential|living_street|tertiary|secondary|primary|service|path)$"]
  (around:1200, {lat}, {lng});
);
out body;
> ;
> out skel qt;
```

### 2.2 Build rules

- OSM `node` → graph vertex; `way` segments → directed edges; weight = Haversine meters.
- Store:
  - `adjacency: Map<string, GraphNode>`
  - `edges: Map<string, GraphEdge[]>`
  - `gridIndex: Map<gridKey, string[]>` — spatial grid **100 m × 100 m** for snap queries.

### 2.3 Failure modes

| Condition | Action |
| --- | --- |
| Primary timeout/429 | Retry mirror once; total ≤ 10 s |
| Still fail or 0 nodes | `pathfinding_mode = 'DIRECT_VECTOR_FALLBACK'` |
| Success | Mode `GRAPH_ASTAR` |

---

## 3. A* pathfinding

### 3.1 Heuristic

\[
f(n) = g(n) + h(n)
\]

- \(g(n)\): meters along edges from start to \(n\).
- \(h(n)\): Haversine from \(n\) to nearest graph node to target (admissible vs road distance in dense urban grids is approximate — acceptable for game).

### 3.2 Implementation requirements

| Item | Spec |
| --- | --- |
| Open set | Binary min-heap (not `Array.sort` per pop) |
| Complexity target | \(O(E \log V)\) |
| Snap | `findNearestGraphNode(lat,lng)` via 100 m grid — O(1) neighborhood |
| Budget | `MAX_ITERATIONS = 600` |
| Over budget | Return path to explored node with best \(h\) toward target |
| Isolated target | Same over-budget rule; never hang worker |

### 3.3 When A* runs (staggered)

Do **not** re-path every zombie every second. Re-run only if:

1. State entered `CHASE` / `INVESTIGATE` / `SWARM`, or  
2. Target moved **> 15 m** from previous path goal, or  
3. Path empty/exhausted.

**≤ 5 A* computations per tick** (round-robin queue across zombies needing paths).

### 3.4 Path smoothing

- Follow polyline of graph nodes; optional string-pulling only across collinear same-edge points (keep simple in V1).

---

## 4. GPS filter pipeline (client, 5 stages)

Order is fixed in `useGPS.ts`:

| Stage | Rule | Effect |
| --- | --- | --- |
| 1 Accuracy gate | `accuracy > 30 m` → `LOW_ACCURACY` | Show weak badge; **exclude** Δs from `distance_m` |
| 2 Min displacement | Haversine Δs **< 2.5 m** vs last accepted | Treat as standstill: `v = 0`, noise `0.05` |
| 3 EMA speed | \(v_{smooth} = 0.4 \cdot v_{raw} + 0.6 \cdot v_{prev}\) | Stabilize noise band |
| 4 Vehicle/jump cap | `v_smooth > 12.0 m/s` → `SPEED_ANOMALY` | Exclude distance; warn UI |
| 5 Rate limit | Send `player_telemetry` max **1 / 1000 ms** | Bandwidth + battery |

### 4.1 Noise mapping (post-filter)

| Speed band | noise |
| --- | --- |
| \(v < 0.5\) | 0.05 |
| \(0.5 \le v \le 1.8\) | 0.20 |
| \(1.8 < v \le 3.5\) | 0.60 |
| \(v > 3.5\) | 1.00 |

### 4.2 Detection radius

\[
R_{detect} = R_{base} + (N_i \times K_{hearing}) \times M_{los}
\]

- \(K_{hearing} = 45\) m  
- \(M_{los} = 1.0\) same road segment / direct; `0.6` if graph corner-blocked (V1: approximate via path vs straight-line ratio or LOS flag)  
- \(R_{base}\) per type: see §5  

---

## 5. Zombie type parameters

| Type | WANDER m/s | CHASE m/s | R_base m | DPS | Special |
| --- | --- | --- | --- | --- | --- |
| Walker | 0.8 | 1.6 | 25 | 10 | Lose scent after 15 s no LOS/noise |
| Runner | 1.2 | 3.2 | 30 | 12 | Reacts when noise ≥ 0.6 |
| Stalker | 1.4 | 2.4 | 40 | 15 | Holds ~20 m until player still, then rush |
| Screamer | 0.7 | 1.2 | 35 | 5 | On CHASE → SWARM pull within 100 m |
| Brute | 0.6 | 1.3 | 20 | 35 | Melee only lethal at ≤ 3.5 m high damage |

Melee engage distance: **3.5 m** (all types enter `ATTACK`).

---

## 6. AI tick (Host Web Worker)

### 6.1 Timing budget (total ≤ 15 ms for ≤ 25 zombies)

| Step | Budget | Work |
| --- | --- | --- |
| 1 Spatial pass | ≤ 1.5 ms | Haversine matrix players×zombies; safe-zone membership |
| 2 FSM + damage | ≤ 2.0 ms | Transition evaluation; Screamer SWARM; ATTACK HP; knock checks |
| 3 Staggered A* | ≤ 9.0 ms | ≤ 5 paths; only per re-path rules §3.3 |
| 4 Interpolate + pack | ≤ 2.5 ms | Move along edge by `speed * dt`; build `world_state_tick` |

### 6.2 Pseudocode

```ts
// worker: roomTick.ts
setInterval(() => {
  const t0 = performance.now();
  const dt = 1.0; // seconds

  const dist = buildDistanceMatrix(players, zombies);      // step 1
  const zones = collectActiveZones(now);

  for (const z of zombies) {                               // step 2
    const target = pickTarget(z, players, dist, zones);
    z.state = transition(z, target, dist, now, events);
  }

  applyAttackDamage(zombies, players, dt);                 // step 2
  checkAllKnocked(players) → maybe endMatch();

  runStaggeredAStar(zombies, queue, budgetMs = 9);         // step 3
  integratePositions(zombies, dt, graphMode);              // step 4

  channel.send('world_state_tick', pack(players, zombies, zones, elapsed));
  // assert performance.now() - t0 <= 15 in dev
}, 1000);
```

### 6.3 FSM transition priority (pure functions)

Evaluate in order (prevents CHASE↔SEARCH ping-pong):

1. Target invalid, `KNOCKED`, `DISCONNECTED`, or in Safe Zone → drop / `SEARCH` or `WANDER`
2. Dist ≤ 3.5 m → `ATTACK`
3. Screamer alert / SWARM command within 100 m → `SWARM` (if not already chasing in-range)
4. Dist ≤ `R_detect` → `CHASE`
5. Noise spike in (R_detect, 1.4×R_detect] → `INVESTIGATE`
6. Timers: search 15 s expire → `WANDER`; spawn idle 2 s → `WANDER`

```ts
export function transition(z: Zombie, ctx: Ctx): ZombieState {
  if (!ctx.targetValid) return ctx.hadTarget ? 'SEARCH' : 'WANDER';
  if (ctx.dist <= 3.5) return 'ATTACK';
  if (ctx.swarmCall) return 'SWARM';
  if (ctx.dist <= ctx.rDetect) return 'CHASE';
  if (ctx.noiseSpike) return 'INVESTIGATE';
  return z.state; // timer-driven paths handled in helpers
}
```

### 6.4 Safe Zone rules in tick

- If target `in_safe_zone`: force leave `ATTACK`/`CHASE`.
- Heal: +2 HP/s for occupants (cap `max_hp`) — applied in tick, not client-authoritative.

---

## 7. Knockdown, rescue, end (server/RPC rules)

| Rule | Spec |
| --- | --- |
| Knock | `hp <= 0` → `KNOCKED`, `knocked_at`, 60 s |
| Rescue | ALIVE rescuer dist ≤ **10.0 m**, hold **3.0 s** → RPC `attempt_rescue` → victim `hp=50`, `ALIVE`; rescuer `rescues_count++` |
| Timeout | 60 s: `max_hp = max(20, max_hp-20)`, `hp = max_hp`, nearest Safe Zone |
| Solo | count=1 → immediate end |
| All knocked | 100% connected `KNOCKED` → end `ALL_KNOCKED` |
| Host end | Confirm → `HOST_ENDED` |
| Disconnect | >10 s → `DISCONNECTED`; grace 90 s; Host migrate 15 s |

---

## 8. Realtime contracts (summary — full in API_SPEC)

Channel: `room:{room_code}`

| Event | Direction | Rate |
| --- | --- | --- |
| `player_telemetry` | client → | ≤ 1 Hz |
| `world_state_tick` | host → | 1 Hz |
| `game_action` | any → (validated) | event-driven |

---

## 9. Testing strategy

### 9.1 Unit (Vitest) — must pass for `src/engine/**` + `geoUtils`

| File | Cases |
| --- | --- |
| `geoUtils.test.ts` | Haversine known pairs; bearing; 5-stage filter including anomaly |
| `astar.test.ts` | 50-node fixture path; disconnected component → best-h return; runtime **< 2 ms** typical path |
| `zombieFSM.test.ts` | All table rows; Screamer SWARM; abort attack on Safe Zone/KNOCKED |
| `survivalRules.test.ts` | 60 s timer; rescue 10 m / 3 s; −20% max HP floor 20; all-knocked end; solo shortcut |

### 9.2 Multi-client (Playwright)

- Two contexts, devsim flag on (`localStorage.outbreak_devsim=1`), same room code.
- Assert telemetry sync, world tick apply, host migration when Host tab closes > 15 s (test may use accelerated timers).

### 9.3 Field checklist (manual)

See IMPLEMENTATION_PLAN field protocol — GPS accuracy, battery, road adherence, rescue UX.

---

## 10. Performance guards

- Never construct new `maplibregl.Map` on state change.
- Update GeoJSON sources or DOM markers in place.
- Zustand selectors for HUD; telemetry writes to store outside React render loop where needed.
- Dev assert tick duration > 15 ms → console warn + telemetry counter.

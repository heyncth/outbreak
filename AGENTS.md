# 10 · AI CODING AGENT INSTRUCTIONS (AGENTS.md)

Rules for AI coding agents (Cursor, Windsurf, Copilot, Claude Code) generating code for **OUTBREAK**.  
Specs live in `docs/01`–`docs/09`. On conflict: **docs win over model memory**; this file wins over casual inference.

---

## 1. Strict invariants (never violate)

1. **No Stamina, no Infection.** Player stats in V1 are only `hp` and `max_hp` (plus derived distance/noise fields already in schema).
2. **No virtual joystick in production.** Character moves only from `navigator.geolocation.watchPosition` (or dev sim when runtime flag `?devsim=1` is set).
3. **No zombie wall/water clipping when graph exists.** `WANDER` / `INVESTIGATE` / `CHASE` / `SEARCH` / `SWARM` follow OSM graph edges from `osmGraph.ts`. Straight-line only if `pathfinding_mode === 'DIRECT_VECTOR_FALLBACK'`.
4. **No auth wall.** Nickname + `player_id` UUID in `localStorage` key `outbreak_player_session`. No signup/login UI in V1.
5. **No per-second Postgres writes for positions.** Positions go Realtime Broadcast only. DB writes are room lifecycle + rescue/end/rematch/safe-zone + match_results.
6. **No `any` in TypeScript.** Interfaces for packets and coords in `src/types/game.ts`.
7. **No map re-init on React state change.** One `maplibregl.Map` per mount; update sources/markers in place.
8. **No Edge-primary game tick.** AI tick runs in Host Web Worker; Edge/serverless only for short API routes.

---

## 2. Explicit ban list (grep patterns)

Do **not** introduce these patterns. Reviewer must fail the diff if found outside approved exceptions.

| Ban | Grep (fail if hits outside exceptions) | Exception |
| --- | --- | --- |
| `any` type | `\bany\b` in `src/**/*.{ts,tsx}` | none |
| Stamina/Infection | `stamina\|infection\|infected` (case-insensitive) | none |
| Joystick | `joystick\|virtual.?dpad` | none |
| Unpinned deps | package.json version values starting `^` or `~` | none |
| Remount map | `new maplibregl.Map` outside `GameMap` init effect | only once per mount |
| Sleep/background loop | `setInterval` in main thread for game tick | must be `roomTick.worker.ts` |
| Service role leak | `SUPABASE_SERVICE_ROLE` in `NEXT_PUBLIC_` or client components | server routes only |
| Position INSERT storm | `INSERT INTO room_players` inside tick/telemetry handler | lifecycle APIs only |
| Blind HP mutate from client | `UPDATE room_players SET hp` in client components | RPC/API only |
| Hardcoded secrets | `eyJ\|sk_live\|AKIA` | none |
| Google/Mapbox maps | `google.maps\|mapboxgl` | none |
| Leaflet | `from 'leaflet'` | none |

**Example review command:**

```bash
rg -n "\bany\b" src --glob '*.{ts,tsx}'
rg -ni "stamina|infection|joystick" src
rg -n "\^|~" package.json
rg -n "SUPABASE_SERVICE_ROLE" src
```

---

## 3. Coding conventions

### 3.1 Units & coordinates
- App state: `{ lat: number; lng: number }`.
- MapLibre / GeoJSON / PostGIS: `[lng, lat]`.
- Distance: **meters**. Speed: **m/s**. Game durations: **seconds**. Absolute time: Unix **ms**.
- Noise: `0.05 | 0.20 | 0.60 | 1.00` only from the official bands (TDD §4.1).

### 3.2 TypeScript
- `strict: true`.
- Realtime payloads: discriminated union on `event` in `src/types/game.ts`.
- Enums as string unions matching API_SPEC.

### 3.3 React / performance
- HUD reads via Zustand selectors (subscribe to slices, not whole store).
- Markers: GeoJSON `source.setData` or DOM `setLngLat` — never React state per zombie per frame.
- Interpolation: LERP 950 ms client-side between ticks.

### 3.4 GPS hook
- Filter order fixed: accuracy gate → 2.5 m deadband → EMA α=0.4 → 12 m/s cap → 1 Hz send.
- `enableHighAccuracy: true`.
- Wake Lock only in `try/catch`; re-request on `visibilitychange`.

### 3.5 Realtime
- Channel: `room:{room_code}`.
- Client send: `player_telemetry` max 1 Hz.
- Host send: `world_state_tick` 1 Hz from worker.
- On unmount: remove channel handlers.

### 3.6 API routes
- Return unified error object: `{ error: { code, message, details? } }`.
- Use status codes from API_SPEC §1.1 exactly.
- Mutations check Host where `NOT_HOST` applies; trust `player_id` but still enforce membership/capacity/status.

### 3.7 Style
- Tailwind tokens/colors from UI spec — don't invent new hexes for core HUD.
- Touch targets ≥ 48 px; rescue button height 64 px.
- No comments that restate the code; comments only for non-obvious why (allowed).

---

## 4. Where logic lives (by concern)

| Concern | Location |
| --- | --- |
| Haversine, bearing, GPS stages | `src/lib/geoUtils.ts` + `src/hooks/useGPS.ts` |
| Overpass + graph + grid | `src/engine/osmGraph.ts` |
| A* | `src/engine/astar.ts` |
| Zombie transitions | `src/engine/zombieFSM.ts` |
| HP / knock / rescue / zone effects | `src/engine/survivalRules.ts` |
| 1 Hz authoritative loop | `src/engine/roomTick.worker.ts` |
| Client mirror state | `src/store/useGameStore.ts` |
| Types | `src/types/game.ts` |
| SQL truth | `supabase/migrations/**` |

Do not duplicate noise bands, rescue distance, or zombie stats in multiple files — import constants from one module.

---

## 5. Canonical constants (single source)

Define once (suggested `src/engine/constants.ts` or `types/game.ts`):

```
MAX_ROOM_PLAYERS = 10
RESCUE_RADIUS_M = 10.0
RESCUE_HOLD_MS = 3000
KNOCKDOWN_SEC = 60
RESPAWN_HP = 50
MAX_HP_PENALTY = 20
MAX_HP_FLOOR = 20
SAFE_ZONE_RADIUS_M = 30
SAFE_ZONE_HEAL_PER_SEC = 2
HOST_ZONE_TTL_SEC = 180
HOST_ZONE_COOLDOWN_SEC = 600
MELEE_RANGE_M = 3.5
HEARING_K = 45
GPS_MIN_DISPLACEMENT_M = 2.5
GPS_ACCURACY_GATE_M = 30
SPEED_ANOMALY_MPS = 12
TELEMETRY_INTERVAL_MS = 1000
TICK_INTERVAL_MS = 1000
TICK_BUDGET_MS = 15
DISCONNECT_MS = 10000
GRACE_MS = 90000
HOST_MIGRATE_MS = 15000
ASTAR_MAX_ITERATIONS = 600
ASTAR_MAX_PER_TICK = 5
OSM_RADIUS_M = 1200
```

If a doc and code disagree, fix code to doc; if two docs disagree, stop and ask.

---

## 6. Verification checklist (run before claiming done)

### 6.1 Commands

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint
pnpm test         # vitest run
pnpm build
```

Optional when e2e present:

```bash
pnpm test:e2e     # playwright
```

### 6.2 Ban greps

```bash
rg -n "\bany\b" src --glob '*.{ts,tsx}'
rg -ni "stamina|infection|joystick" src
rg -n "\^|~" package.json
```

### 6.3 Scenario checks (map to product rules)

- [ ] **Q11 Knockdown/Rescue:** `hp <= 0` → `KNOCKED` + 60 s; hold 3 s ≤ 10 m → `hp = 50`; timeout → `max_hp = max(20, max_hp - 20)` + Safe Zone; solo → instant end.
- [ ] **Q12 End:** all connected `KNOCKED` OR Host end → `ENDED` + `match_results`.
- [ ] **Q1 Capacity:** 11th join → `409 ROOM_FULL` (RPC + trigger).
- [ ] **Host migration:** Host silence > 15 s → promote next ALIVE; tick continues.
- [ ] **GPS:** stages in order; anomaly does not add distance.
- [ ] **Map:** no `new maplibregl.Map` on prop/state churn.
- [ ] **Dev sim:** listeners dead when env flag not `'true'`.

### 6.4 Manual smoke (when UI touched)

1. Home loads; GPS chip states correct.
2. Create/join room on two contexts (dev sim on).
3. Start → zombies visible → move → telemetry sync.
4. Force knock (dev) → rescue → summary → rematch.

---

## 7. Definition of Done (code task)

- [ ] Spec clause cited in PR/summary (e.g. `docs/06-TDD.md §6.3`)
- [ ] Types updated in `src/types/game.ts` if packets changed
- [ ] Constants centralized (§5)
- [ ] Unit tests for any new engine branch
- [ ] Commands §6.1 green
- [ ] Greps §6.2 clean
- [ ] No new dependencies unless justified (prefer zero new deps)

---

## 8. What not to do

- Do not “improve” stack (swap MapLibre, add Redux, add auth).
- Do not add Stamina/Infection/weapons “for fun”.
- Do not write positions to Postgres every second.
- Do not run game tick on serverless Edge as primary.
- Do not invent room codes longer than 6 or change status enums without updating **07** and **08** first.
- Do not commit secrets.
- Do not expand scope beyond the task card (see `09-IMPLEMENTATION_PLAN.md`).

---

## 9. Escalation

Stop and ask the human when:
- Two docs contradict.
- A change requires schema enum alteration.
- Free-tier quota math would break (PRD §5 / TECH_STACK §4).
- Field safety copy needs to change.

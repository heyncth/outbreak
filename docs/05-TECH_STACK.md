# 05 · TECHNOLOGY STACK & RATIONALE (v2.0)

## 1. Pinned dependencies

Exact `minor.patch` pins — **no `^` or `~`** (lockfile must match). Package manager: **pnpm** (or npm with committed lockfile). `engines.node`: `>=20`.

| Package | Version | Why |
| --- | --- | --- |
| `next` | `14.2.15` | Stable App Router + PWA plugin compat (avoid Next 15/React 19 churn) |
| `react` / `react-dom` | `18.3.1` | Pair with Next 14 |
| `typescript` | `5.6.2` | Strict types for geo/FSM/packets |
| `tailwindcss` | `3.4.13` | Mobile-first dark UI speed |
| `maplibre-gl` | `4.7.1` | WebGL map, v4 worker/WebGL APIs |
| `@supabase/supabase-js` | `2.45.4` | Realtime Broadcast v2 stable |
| `zustand` | `4.5.5` | v4 selectors (avoid v5 API breaks) |
| `@ducanh2912/next-pwa` | `10.2.9` | SW + manifest generation |
| `vitest` | pin at scaffold | Unit tests for engine |
| `@playwright/test` | pin at scaffold | Multi-client sim |

Dev-only optional: none required beyond above for MVP.

---

## 2. Layer choices

| Layer | Choice | Purpose |
| --- | --- | --- |
| Framework | Next.js 14 App Router + React 18 | PWA, routes, API routes |
| Language | TypeScript strict | Typed coords, FSM, realtime packets |
| Styling | Tailwind CSS 3.4 | High-contrast dark, fast iteration |
| Map | MapLibre GL JS 4.x | Free WebGL 60 fps on mobile |
| Map data | OSM + Overpass API | Global streets + walkable graph |
| Client state | Zustand 4.x | High-frequency updates without full-tree re-render |
| Backend realtime | Supabase Realtime Broadcast | Rooms 5–10, no self-hosted WS |
| DB | PostgreSQL 15+ + PostGIS | `ST_DWithin` / `ST_Distance` |
| PWA | `@ducanh2912/next-pwa` | Installable shell |

---

## 3. Rejected alternatives (do not swap without decision)

| Rejected | Why not |
| --- | --- |
| Google Maps / Mapbox GL | Requires billing/API key; pay-per-load |
| Leaflet.js | DOM/Canvas 2D — FPS drop with 20+ interpolated markers + rotate |
| Socket.io + paid VPS (Render/Fly) | Cost or free-tier sleep; ops burden |
| Redux / React Context for GPS | Re-render storms at 1 Hz; Zustand store outside render path |
| Edge/Serverless always-on tick | Stateless, short timeouts — cannot hold 20-min A* + 20 zombie state |
| Per-second Postgres position writes | Burns free-tier rows/messages; use Broadcast only |

---

## 4. Free-tier quotas & $0 operating design

| Service | Free limits (design assumptions) | Design response |
| --- | --- | --- |
| Supabase Free | ~200 concurrent realtime, ~2M msgs/mo, 500 MB DB | **Broadcast-only** for 1 Hz telemetry/ticks; no INSERT/UPDATE of positions per second. ~13.2k msgs/match × 10 players → ~150 matches/mo budget headroom |
| Vercel Hobby | 100 GB bandwidth; functions ~10 s timeout | Keep API routes short (create/join/end/rescue); **no long loops in serverless** |
| Overpass public | ~10k queries/day; IP ban on burst | **One graph fetch per match Start** from Host; cache in `sessionStorage`; mirrors + vector fallback |

---

## 5. Browser limits & solutions

### 5.1 Screen Wake Lock
- Request on room `ACTIVE`; wrap in `try/catch`.
- Re-acquire on `visibilitychange` → visible.
- Unsupported → banner + `WakeLock: Off` chip (see UI spec).

### 5.2 GPS throttling & drift
- Consumer `watchPosition` ≈ **1 Hz** max useful.
- Client filter pipeline (5 stages) in TDD: accuracy gate → 2.5 m deadband → EMA → 12 m/s cap → 1 Hz send rate.

### 5.3 Background / tab kill
- Co-op requires network; not full offline play.
- Disconnect grace **90 s**; wake lock reduces screen-off kills.

---

## 6. Offline / network-resilient PWA strategy

**Goal:** Survive 15–30 s 4G drops; open shell fast on weak signal — **not** full offline multiplayer.

| Asset | Strategy |
| --- | --- |
| App shell (HTML/JS/CSS/icons) | Precache in Service Worker install |
| Map tiles near play area | Runtime `Stale-While-Revalidate` into CacheStorage |
| OSM graph for active room | `sessionStorage` / IndexedDB after first fetch |
| GPS distance accumulation | Local buffer; flush on reconnect |
| Realtime players/zombies | Requires network; freeze last known + grace rules |

---

## 7. Authoritative tick architecture (locked)

**Host-Primary + auto migration** (Edge is not primary).

```
Host device
  └─ Web Worker @ 1000ms
       ├─ distance / safe zone
       ├─ FSM update + damage
       ├─ staggered A* (budget)
       └─ broadcast world_state_tick
            └─ all clients (Supabase Realtime)
```

- Worker keeps UI of Host jank-free.
- If Host heartbeat lost **> 15 s** → promote next ALIVE earliest joiner; new Host starts worker with current world snapshot.
- Clients only send `player_telemetry` (≤ 1 Hz); never simulate authoritative zombie HP/positions for scoring.

---

## 8. Unit conventions (normative)

| Quantity | Unit | Notes |
| --- | --- | --- |
| Coordinates in app state | `{ lat, lng }` | MapLibre/PostGIS receive `[lng, lat]` |
| Distance | meters (`m`) | Haversine for geo; graph edges store meters |
| Speed | m/s | |
| Time in game logic | seconds | Timestamps Unix ms where absolute |
| Noise | dimensionless 0.05–1.0 | |

---

## 9. Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Prod | Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod | Anon client |
| `NEXT_PUBLIC_DEV_SIMULATE_GPS` | Dev | Enable WASD/click sim (`'true'` only) |
| `OVERPASS_URL` | Optional | Primary Overpass endpoint override |
| `OVERPASS_MIRROR_URL` | Optional | Fallback endpoint |

Secrets (if any service role key for API routes) **never** in `NEXT_PUBLIC_*`.

# 09 · IMPLEMENTATION PLAN (v2.0)

## 1. Project directory structure

```
outbreak-pwa/
├── public/
│   ├── manifest.webmanifest
│   └── icons/
├── supabase/
│   ├── migrations/
│   │   └── 20261110000001_init_outbreak.sql
│   └── seed.sql
├── docs/                          # 01–10 specs (this set)
├── src/
│   ├── app/
│   │   ├── page.tsx               # Home
│   │   ├── room/[code]/page.tsx   # Lobby + Game + Summary
│   │   └── api/
│   │       └── rooms/
│   │           ├── create/route.ts
│   │           ├── join/route.ts
│   │           ├── [code]/route.ts
│   │           ├── start/route.ts
│   │           ├── end/route.ts
│   │           ├── rematch/route.ts
│   │           └── safe-zone/route.ts
│   ├── app/api/rescue/route.ts
│   ├── app/api/matches/[roomId]/route.ts
│   ├── components/
│   │   ├── map/GameMap.tsx
│   │   ├── hud/SurvivalHUD.tsx
│   │   ├── lobby/LobbyView.tsx
│   │   └── summary/MatchSummary.tsx
│   ├── engine/
│   │   ├── osmGraph.ts
│   │   ├── astar.ts
│   │   ├── zombieFSM.ts
│   │   ├── survivalRules.ts
│   │   └── roomTick.worker.ts
│   ├── hooks/
│   │   ├── useGPS.ts
│   │   ├── useWakeLock.ts
│   │   └── useRealtimeRoom.ts
│   ├── store/useGameStore.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── geoUtils.ts
│   └── types/game.ts
├── tests/
│   ├── unit/
│   └── e2e/
├── package.json
└── tailwind.config.ts
```

---

## 2. Dependency graph (phases & critical tasks)

```text
P1.1 PWA scaffold
  └─► P1.2 geoUtils + useGPS + wake lock
        └─► P1.3 GameMap (MapLibre)
              └─► P1.4 Player marker + noise ring
                    └─► P2.1 SQL migrations + seed
                          └─► P2.2 Room APIs + LobbyView
                                └─► P2.3 useRealtimeRoom telemetry
                                      └─► P2.4 Disconnect grace (client+host rules)
                                            └─► P3.1 osmGraph (Overpass)
                                                  ├─► P3.2 astar.ts
                                                  │     └─► P3.3 zombieFSM.ts
                                                  │           └─► P3.4 roomTick.worker + broadcast
                                                  └─► P4.1 Safe Zone rules
                                                        └─► P4.2 Knockdown/rescue RPC UX
                                                              └─► P4.3 End match + all-knocked
                                                                    └─► P4.4 MatchSummary + rematch
```

**Hard dependencies:** P2 needs P1 map/GPS; P3 needs P2 rooms; P4 needs P3 tick for authoritative HP.

---

## 3. Phases, task cards, dependencies, DoD

Verification gate: **phase-end only** (unit + manual checklist at phase boundary).

---

### Phase 1 — Core PWA, MapLibre, GPS

#### Task 1.1 — Scaffold Next.js PWA
- **Files:** `package.json`, `next.config.*`, `public/manifest.webmanifest`, `src/app/layout.tsx`, `tailwind.config.ts`
- **Deps:** none
- **Est:** 4 h
- **DoD:**
  - [ ] Exact pins from TECH_STACK §1 (no `^`/`~`)
  - [ ] `npm run build` succeeds
  - [ ] Manifest valid; installable on Android Chrome
  - [ ] Dark tokens from UI spec present in CSS

#### Task 1.2 — geoUtils + useGPS + Wake Lock
- **Files:** `src/lib/geoUtils.ts`, `src/hooks/useGPS.ts`, `src/hooks/useWakeLock.ts`, `src/types/game.ts`
- **Deps:** 1.1
- **Est:** 8 h
- **DoD:**
  - [ ] Haversine + bearing unit tests pass
  - [ ] 5-stage filter implemented (TDD §4)
  - [ ] `watchPosition` high accuracy; noise bands match spec
  - [ ] Wake lock request/release + `visibilitychange` re-acquire in try/catch
  - [ ] Dev sim path gated by `NEXT_PUBLIC_DEV_SIMULATE_GPS`

#### Task 1.3 — GameMap integration
- **Files:** `src/components/map/GameMap.tsx`
- **Deps:** 1.1
- **Est:** 6 h
- **DoD:**
  - [ ] MapLibre init once (no remount on state change)
  - [ ] Style loads offline-cached shell still shows UI if tiles fail
  - [ ] `map.resize()` on breakpoint change only

#### Task 1.4 — Player marker + noise ring
- **Files:** `src/components/map/GameMap.tsx`, store hooks
- **Deps:** 1.2, 1.3
- **Est:** 4 h
- **DoD:**
  - [ ] Marker at GPS position; ring radius from noise
  - [ ] LERP 950 ms between updates
  - [ ] Weak GPS badge when accuracy > 30 m

**Phase 1 gate:** unit geo/GPS green; manual: open PWA, see self move on map outdoors.

---

### Phase 2 — Rooms & realtime co-op

#### Task 2.1 — SQL + Supabase project
- **Files:** `supabase/migrations/*.sql`, `supabase/seed.sql`, `src/lib/supabase.ts`
- **Deps:** 1.1
- **Est:** 6 h
- **DoD:**
  - [ ] `supabase db push` applies cleanly
  - [ ] Capacity trigger rejects 11th player
  - [ ] `attempt_rescue` / `join_room` / `end_match` exist
  - [ ] Seed `DEMO01` loads
  - [ ] DOWN block present in migration file

#### Task 2.2 — Room APIs + LobbyView
- **Files:** `src/app/api/rooms/**`, `src/components/lobby/LobbyView.tsx`, `src/app/room/[code]/page.tsx`
- **Deps:** 2.1, 1.2
- **Est:** 10 h
- **DoD:**
  - [ ] create/join/get/start/end match API_SPEC codes (`404/403/409`)
  - [ ] Unified error schema on all failures
  - [ ] Lobby roster `n/10`, copy link, Host start button
  - [ ] GPS permission gate before create/join

#### Task 2.3 — Realtime telemetry sync
- **Files:** `src/hooks/useRealtimeRoom.ts`, `src/store/useGameStore.ts`
- **Deps:** 2.2
- **Est:** 8 h
- **DoD:**
  - [ ] Channel `room:{code}` subscribe/unsubscribe cleanup
  - [ ] `player_telemetry` ≤ 1 Hz
  - [ ] Second device sees first device move < 350 ms P95 on LAN/strong wifi
  - [ ] Types only in `src/types/game.ts` (no `any`)

#### Task 2.4 — Disconnect grace rules
- **Files:** `useRealtimeRoom.ts`, survival helpers
- **Deps:** 2.3
- **Est:** 6 h
- **DoD:**
  - [ ] 10 s → DISCONNECTED UI + ghost
  - [ ] 90 s grace restore
  - [ ] Host migrate at 15 s (logic unit-tested; full flow may complete in Phase 3 when tick exists)

**Phase 2 gate:** two browsers join same code, see each other; kill network → grace states; room full → 409.

---

### Phase 3 — OSM graph & Zombie AI

#### Task 3.1 — osmGraph.ts
- **Files:** `src/engine/osmGraph.ts`
- **Deps:** 2.2
- **Est:** 8 h
- **DoD:**
  - [ ] Overpass query radius 1200 m, timeout 8 s
  - [ ] Mirror retry; ≤ 10 s fail → `DIRECT_VECTOR_FALLBACK`
  - [ ] Graph + 100 m grid index built
  - [ ] Cached per match in sessionStorage

#### Task 3.2 — astar.ts
- **Files:** `src/engine/astar.ts`, `tests/unit/astar.test.ts`
- **Deps:** 3.1
- **Est:** 8 h
- **DoD:**
  - [ ] Binary heap open set
  - [ ] `MAX_ITERATIONS = 600` + best-h fallback
  - [ ] Fixture tests pass; typical path < 2 ms
  - [ ] Snap-to-node via grid

#### Task 3.3 — zombieFSM.ts
- **Files:** `src/engine/zombieFSM.ts`, `tests/unit/zombieFSM.test.ts`
- **Deps:** 3.2
- **Est:** 10 h
- **DoD:**
  - [ ] All transition table rows covered by tests
  - [ ] Priority order per TDD §6.3 (no infinite CHASE/SEARCH)
  - [ ] 5 type params from TDD §5
  - [ ] Safe Zone abort attack

#### Task 3.4 — roomTick.worker + world broadcast
- **Files:** `src/engine/roomTick.worker.ts`, host wiring in room page
- **Deps:** 3.3, 2.3
- **Est:** 10 h
- **DoD:**
  - [ ] Worker interval 1000 ms; budget assert dev warn > 15 ms
  - [ ] Staggered A* ≤ 5 / tick
  - [ ] `world_state_tick` schema-valid
  - [ ] Non-host clients only render ticks
  - [ ] Host migration restarts worker with snapshot (if 2.4 partial)

**Phase 3 gate:** zombies path on streets; screamer swarm test; unit FSM/ASTAR green; two clients see same zombie motion.

---

### Phase 4 — Survival rules, end & summary

#### Task 4.1 — Safe Zones
- **Files:** `survivalRules.ts`, safe-zone API, map layers
- **Deps:** 3.4
- **Est:** 6 h
- **DoD:**
  - [ ] System zones spawn per start rules
  - [ ] +2 HP/s, attack block in radius 30 m
  - [ ] Host create: 3 min TTL, 10 min CD, API cooldown enforced
  - [ ] Expiry removes zone

#### Task 4.2 — Knockdown / rescue / auto-respawn
- **Files:** `survivalRules.ts`, rescue API, HUD hold button
- **Deps:** 4.1
- **Est:** 8 h
- **DoD:**
  - [ ] KNOCKED at hp≤0; 60 s countdown UI
  - [ ] Hold 3 s ≤ 10 m → RPC → hp 50
  - [ ] Timeout −20% max hp floor 20 → Safe Zone
  - [ ] Solo instant end
  - [ ] `survivalRules.test.ts` green

#### Task 4.3 — End match + all-knocked
- **Files:** end API, tick check, confirm modal
- **Deps:** 4.2
- **Est:** 4 h
- **DoD:**
  - [ ] All connected KNOCKED → ENDED + match_results
  - [ ] Host confirm end → ENDED
  - [ ] Wake lock released; channel state settled

#### Task 4.4 — Summary + rematch + result GET
- **Files:** `MatchSummary.tsx`, rematch API, matches GET
- **Deps:** 4.3
- **Est:** 6 h
- **DoD:**
  - [ ] Stats: time, distance, max speed, rescues + tech metrics in summary_json
  - [ ] Rematch resets per spec
  - [ ] GET match result 200/404

**Phase 4 gate:** full match loop playable; all unit tests pass; checklist below.

---

## 4. Phase-end verification (no per-task gates)

| Phase | Automated | Manual |
| --- | --- | --- |
| 1 | `vitest` geo/GPS | Outdoor walk: marker + noise bands + screen stays on |
| 2 | API integration tests (optional) / typecheck | 2 devices join; full room 409; airplane mode grace |
| 3 | ASTAR + FSM unit | Zombies on streets; fallback mode flag |
| 4 | survivalRules unit + full `vitest` | Knock/rescue/end/rematch happy paths |

**Commands (every phase end):**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

---

## 5. Field test protocol (Week 4)

**Goal:** Validate SLAs and KPIs from PRD §5 on real streets.

### 5.1 Setup
- Devices: ≥ 2 phones (1 Android Chrome primary, 1 iOS Safari if available).
- Location: open sidewalks + one denser block (GPS multipath).
- Accounts: nicknames only; room code from Host phone.
- Logging: enable telemetry dump to `summary_json` + local console export.

### 5.2 Script

| Step | Action | Record |
| --- | --- | --- |
| F1 | Cold load PWA on 4G | load ms |
| F2 | Create room, second device join | join latency, roster sync |
| F3 | Host start; time to first world tick | graph_build_ms, tick presence |
| F4 | Walk 2 min (≤ 1.5 m/s) | noise = low, distance Δ |
| F5 | Sprint 30 s | noise = high, SPEED_ANOMALY if any |
| F6 | Let Walker approach; take hits to 0 HP | knock path, countdown |
| F7 | Teammate rescue hold 3 s | success, hp=50 |
| F8 | Second knock; wait 60 s | max_hp −20, safe zone |
| F9 | Host create safe zone; stand inside | heal 2/s, zombies edge |
| F10 | Airplane mode 20 s on one client | grace, resync |
| F11 | Close Host tab > 15 s | host migration |
| F12 | Host end match | summary fields complete |
| F13 | Rematch | reset stats |
| F14 | Battery before/after | % / 15 min |

### 5.3 Pass criteria (from PRD)
- Median match 12–20 min on full session day
- Rescue success 40–70%
- Road adherence ≥ 95% (spot-check 20 zombie frames)
- Crash-free ≥ 90%
- Battery ≤ 8% / 15 min
- No P0: lost match_results, soft-locked room, infinite tick stall

### 5.4 Debrief
File balance changes (Walker DPS, R_base, 60 s timer) as tuning PRs — do not silently change constants in code without doc update.

---

## 6. Out of plan (explicit)
- Weekly demo milestones (skipped by decision)
- Per-task verification gates (phase-end only)
- V2 features from PRD §7.2

# 01 · PRODUCT REQUIREMENTS DOCUMENT (PRD)

**Project:** OUTBREAK – Real-World GPS Zombie Survival  
**Version:** 1.0 (MVP – Solo & Co-op)  
**Distribution:** Progressive Web App (PWA)

---

## 1. Vision & Product Goals

- **[Fact] Product definition:** OUTBREAK is a location-based GPS survival game (real-world augmented play) that runs in a mobile browser as a PWA.
- **[Inference] Experience goal:** Deliver tense, physical gameplay where players run outdoors to escape smart-behavior Zombies (pseudo-AI) and coordinate small-team rescues (5–10 players).

---

## 2. Functional Scope (In-Scope V1)

1. **Worldwide Street Map:** Real street network via OpenStreetMap rendered with MapLibre GL JS.
2. **Real GPS Movement:** Character position comes only from device GPS. No virtual joystick in production.
3. **Game Modes:**
   - **Solo:** One player in a private room.
   - **Co-op:** 2–10 players in one room via 6-character code or share link.
4. **Core Survival Systems:**
   - **HP:** Starts at 100/100. Reduced by nearby Zombie attacks.
   - **Knockdown & Rescue:** At HP = 0 the player is `KNOCKED`. A teammate within `< 10 m` has 60 s to rescue. On timeout, auto-respawn at nearest Safe Zone with −20% Max HP (floor 20).
   - **Noise Level:** Derived from GPS speed (Δs / Δt). Directly scales Zombie detection radius.
5. **Safe Zones:** Damage-immune + HP regen areas. System-generated and Host-created temporary zones.
6. **Server-Authoritative Pseudo-AI Zombies:** 5 types (`Walker`, `Runner`, `Stalker`, `Screamer`, `Brute`), 6 FSM states, A* pathfinding on OSM road graph (no wall/water clipping when graph exists).
7. **Match End & Summary:** Ends when all players are `KNOCKED` together or Host ends the match. Summary shows survival time, total distance, max speed, rescues.

---

## 3. Out-of-Scope V1

- **[Fact] Removed by design:** Stamina bar, Infection (turning players into Zombies), full accounts (nickname only), weapons/crafting/combat items.

---

## 4. Non-Functional Requirements

- **[Fact] PWA & screen lock:** Mobile browsers throttle background JS when the screen is off. V1 uses **Screen Wake Lock API** to keep the screen on during matches.
- **[Inference] Sync latency:** Player and Zombie positions sync via WebSockets (Supabase Realtime) with target latency **< 1000 ms** (see §5 for tighter P95 target).
- **[Fact] Field safety:** Players are never forced into dangerous areas. Host has an emergency stop control.
- **[Fact] Battery:** Match must not drain more than 8% battery per 15 minutes of play (see §5).

---

## 5. Success Metrics

### 5.1 Technical Performance (SLAs)

| Item | Target | Fail threshold | Rationale |
| --- | --- | --- | --- |
| PWA cold load | ≤ 2.5 s (4G) | > 5.0 s | Web Vitals FCP/LCP to Nickname screen |
| Map + OSM graph init | ≤ 3.5 s | > 8.0 s | MapLibre tiles + Overpass 1.2 km graph on Start |
| GPS sample rate | 0.5–1.0 Hz | < 0.2 Hz | Consumer `watchPosition` is ~1 Hz physical max |
| GPS horizontal accuracy | ≤ 10 m outdoors | > 25 m sustained | Rescue (10 m) and melee (3.5 m) need precision |
| Realtime sync latency | ≤ 350 ms (P95) | > 1000 ms | `world_state_tick` Broadcast across room |
| A* compute | ≤ 15 ms / tick | > 100 ms / tick | 15–20 Zombies in one 1000 ms tick |
| Wake Lock held | 100% of Android sessions | Screen sleeps mid-match | `navigator.wakeLock.request('screen')` |

### 5.2 Gameplay & Product KPIs

| Metric | MVP target | Rationale |
| --- | --- | --- |
| Median match duration | 12–20 min | < 5 min = too hard; > 30 min with no knocks = too weak |
| Distance moved per match | 800 m – 2.0 km | Proves real physical movement |
| Rescue success rate | 40–70% of knockdowns | Validates Q11 (60 s / 10 m) balance |
| Road adherence rate | ≥ 95% of Zombie movement | OSM graph + A* quality |
| Crash-free sessions | ≥ 90% | Valid Q12 end + full Summary render |
| Battery drain | ≤ 8% / 15 min | Wake Lock + WebGL + high-accuracy GPS |

### 5.3 Telemetry (written to `match_results.summary_json`)

```json
{
  "tech_metrics": {
    "pwa_load_ms": 1820,
    "osm_graph_build_ms": 2150,
    "avg_gps_accuracy_m": 6.4,
    "avg_gps_hz": 0.92,
    "avg_realtime_ping_ms": 145,
    "wake_lock_drops": 0
  },
  "gameplay_metrics": {
    "match_duration_sec": 940,
    "total_team_distance_m": 5420,
    "total_knockdowns": 4,
    "successful_rescues": 3,
    "auto_respawns_at_safezone": 1,
    "end_reason": "HOST_ENDED"
  }
}
```

---

## 6. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | GPS drift / urban canyon jumps | False distance, wrong melee range | High | 5-stage GPS filter (see TDD §4); accuracy gate 30 m; min displacement 2.5 m |
| R2 | Battery drain kills session mid-run | Match ruined | Medium | Wake Lock only during ACTIVE; 1 Hz telemetry throttle; avoid per-second Postgres writes |
| R3 | Browser kills tab / screen off | Player vanishes | High | Wake Lock + `visibilitychange` re-acquire; 90 s disconnect grace |
| R4 | Overpass API rate-limit or timeout | Match start stalls | Medium | Mirror fallback; after 2 fails → `DIRECT_VECTOR_FALLBACK`; call once per match, cache graph |
| R5 | Host device dies mid-match | AI tick stops for all | Medium | Host migration after 15 s to next ALIVE player (Web Worker tick moves) |
| R6 | Free-tier quota exhaustion | Realtime / DB offline | Low | Broadcast-only for 1 Hz positions; never INSERT positions per second |
| R7 | Player runs into traffic while staring at phone | Physical injury | Medium | Design principle: no forced path into danger; Host emergency stop; high-contrast UI for quick glances |
| R8 | iOS Safari Wake Lock / PWA gaps | Screen sleeps, install fails | Medium | Detect support; banner fallback; document iOS 16.4+ requirement |

---

## 7. Product Backlog — V1 and V2 (Merged)

### 7.1 V1 Must ship (MVP)

| ID | Feature | Notes |
| --- | --- | --- |
| V1-01 | Nickname session (no auth wall) | `localStorage` key `outbreak_player_session` |
| V1-02 | Create / join room (code 6 chars, max 10) | HTTP 409 when full |
| V1-03 | MapLibre map + GPS marker + noise ring | Real GPS only in prod |
| V1-04 | Realtime telemetry + world tick | Supabase Broadcast |
| V1-05 | OSM graph + A* Zombie movement | Fallback vector mode |
| V1-06 | 5 Zombie types + 6-state FSM | Host Web Worker tick |
| V1-07 | HP, KNOCKED 60 s, rescue < 10 m hold 3 s, −20% max HP | Solo: instant game over at KNOCKED |
| V1-08 | Safe Zones (system + Host temporary) | 30 m, 2 HP/s, Host zone 3 min / 10 min CD |
| V1-09 | Match end (all knocked / host stop) + Summary | Persist `match_results` |
| V1-10 | Wake Lock + disconnect grace 90 s | Host migrate 15 s |
| V1-11 | PWA install + offline app shell | Network-resilient, not full offline play |
| V1-12 | Dev GPS simulator (`?devsim=1` runtime flag) | Dev-only click/WASD |

### 7.2 V2+ deferred

| ID | Feature | Why deferred |
| --- | --- | --- |
| V2-01 | Stamina bar | Cut for MVP focus (explicit product decision) |
| V2-02 | Infection / play-as-Zombie | Cut for MVP focus |
| V2-03 | Weapons & crafting | Cut for MVP focus |
| V2-04 | Real accounts / profiles / friends list | Nickname session sufficient for v1 |
| V2-05 | Global leaderboards | Needs stable accounts + anti-cheat |
| V2-06 | Zombie loot / evolution / hordes meta | Post-MVP content |
| V2-07 | Voice / ping wheel | Comms beyond rescue button |
| V2-08 | Custom room rules (density, radius, duration) | Host quick-config exists minimally in lobby |
| V2-09 | iOS background location / significant-change | Battery + policy complexity |
| V2-10 | Anti-cheat server validation of telemetry | MVP trusts client IDs (documented shortcut) |

---

## 8. Special Edge Rules (Normative)

### 8.1 Solo mode

- Solo room = 1 player.
- When that player reaches `HP <= 0` → `KNOCKED` → **instant match end** (`end_reason = 'ALL_KNOCKED'` equivalent; no 60 s wait, no auto-respawn path).
- Rationale: no teammate can rescue; 60 s wait would be dead time.

### 8.2 Host disconnect

- If `host_player_id` misses heartbeat **> 15 s** while room is `ACTIVE`:
  - Promote the earliest-joined player currently `ALIVE` to Host.
  - Transfer AI tick ownership (Web Worker) and End Match button rights.
- If no `ALIVE` player remains eligible, apply normal all-knocked end rules.

### 8.3 Emergency stop

- Host always has **[🛑 End match]** with confirm dialog, regardless of player counts.

---

## 9. Open Questions (tracked, not blocking V1)

1. Exact Overpass mirror list order at build time.
2. Whether rematch resets `max_hp` penalties (current design: full reset to 100).
3. Stalker hold-distance tuning after first field tests.

# 02 · USER STORIES & ACCEPTANCE CRITERIA (v2.0)

**Conventions**

**MoSCoW priority**
- **[M] Must-have:** Required for V1 MVP to run.
- **[S] Should-have:** Important for field error handling and smooth co-op.
- **[C] Could-have:** Nice-to-have; last sprint.

**Story points (Fibonacci)**
- `1 pt`: Small UI/state change (< 1 h).
- `2 pts`: One component or one simple API.
- `3 pts`: Client + Realtime/DB flow.
- `5 pts`: Complex algorithm (OSM Graph, A*, FSM, Host Migration).

**AC style:** Testable Gherkin with hard numeric thresholds.

---

## EPIC 1: Access, Permissions & Room Management (Onboarding & Lobby)

### US-1.1: Quick join by nickname (no-auth session)
- **Priority:** `[M]` | **Effort:** `1 pt`
- **Story:** As a player, I want to enter a nickname and land in the lobby with no account so I can play with friends immediately.
- **AC:**
  1. **Given** first visit, **When** nickname length is `2`–`20` (letters, digits, space, underscore), **Then** system creates `player_id` (UUID v4) and stores `{ player_id, nickname }` in `localStorage` under `outbreak_player_session`.
  2. **Given** `outbreak_player_session` exists, **When** page reloads, **Then** nickname and `player_id` restore automatically.
  3. Nickname containing only whitespace or control characters is rejected with inline error.

### US-1.2: GPS permission + denial fallback
- **Priority:** `[M]` | **Effort:** `2 pts`
- **Story:** As a player, I want clear GPS permission handling and recovery steps if I denied access.
- **AC:**
  1. **Given** player taps Create or Join, **When** `navigator.geolocation.getCurrentPosition` is called with `enableHighAccuracy: true`, `timeout: 5000`, **Then** proceed only on valid coordinates.
  2. **Edge — permission denied (`error.code === 1`):** Show blocking modal with browser-specific steps to re-enable Location, plus **[Re-check GPS]** button. No navigation until success.
  3. **Edge — unavailable/timeout (`error.code === 2 | 3`):** Auto-retry up to **3** times; if still failing show: *"No GPS signal found. Move outdoors."*
  4. GPS status indicator on Home: ready (`±X m`) vs searching.

### US-1.3: Create room, share link, capacity guard
- **Priority:** `[M]` | **Effort:** `3 pts`
- **Story:** As Host, I want a 6-char room code (max 10 players) and a shareable invite link.
- **AC:**
  1. **Given** **[Create room]**, **When** `POST /api/rooms/create` runs, **Then** generate unique `room_code` (uppercase alphanumerics excluding `0/O`, `1/I`), `status = 'WAITING'`, `host_player_id = creator`, creator inserted into `room_players`.
  2. **Edge — room full:** **Given** 10 rows already in `room_players`, **When** 11th calls `POST /api/rooms/join`, **Then** `HTTP 409` with `ROOM_FULL: Room is full (max 10)`.
  3. **Edge — match already started:** **Given** `status !== 'WAITING'` and caller is not an existing member, **Then** `HTTP 403` `MATCH_ALREADY_STARTED`.
  4. **Edge — unknown code:** `HTTP 404` `ROOM_NOT_FOUND`.
  5. Lobby shows live roster `n/10` and Host **[START SURVIVAL]**.

---

## EPIC 2: GPS Movement, Device & Dev Simulator

### US-2.1: Realtime GPS, noise engine, distance integrity
- **Priority:** `[M]` | **Effort:** `3 pts`
- **Story:** As an in-match player, I want my map position to follow real movement and noise to reflect my speed.
- **AC:**
  1. Publish position only when displacement ≥ **2.5 m** from last accepted fix **or** every **1000 ms** (deadband against GPS jitter).
  2. If `coords.accuracy > 30 m`, show badge `⚠️ GPS weak (±Xm)` and **do not** add jump deltas to `distance_m`.
  3. Noise mapping:
     - `v < 0.5 m/s` → `noise = 0.05`
     - `0.5 ≤ v ≤ 1.8 m/s` → `noise = 0.20`
     - `1.8 < v ≤ 3.5 m/s` → `noise = 0.60`
     - `v > 3.5 m/s` → `noise = 1.00`
  4. If smoothed `v > 12.0 m/s`, flag `SPEED_ANOMALY`, exclude Δs from score, show warning.

### US-2.2: Screen Wake Lock + unsupported fallback
- **Priority:** `[S]` | **Effort:** `2 pts`
- **Story:** As a runner outdoors, I want the screen to stay on without draining battery when the OS blocks wake lock.
- **AC:**
  1. **Given** room becomes `ACTIVE` and `'wakeLock' in navigator`, **Then** `navigator.wakeLock.request('screen')` inside `try/catch`.
  2. On `visibilitychange` → visible, re-request wake lock and resync position.
  3. **Edge — unsupported/rejected:** Non-blocking banner *"Battery saver may turn off the screen. Tap periodically to keep it awake."* plus HUD badge `WakeLock: Off`.

### US-2.3: Dev GPS simulator
- **Priority:** `[M] (Dev/Testing)` | **Effort:** `2 pts`
- **Story:** As a developer, I want click-to-move / WASD when `NEXT_PUBLIC_DEV_SIMULATE_GPS=true` to test AI and rescue at a desk.
- **AC:**
  1. **Given** `NEXT_PUBLIC_DEV_SIMULATE_GPS === 'true'`, **When** Game opens, **Then** show `🛠️ DEV SIMULATOR` panel.
  2. **Shift+Click** on map teleports/moves player to clicked point; **WASD** moves at speed from slider `0–6.0 m/s`.
  3. Simulated coords feed the **same** telemetry pipeline as real GPS (noise, A*, knockdown, rescue).
  4. **Security invariant:** When env ≠ `'true'`, all sim listeners are stripped/disabled in the production bundle.

---

## EPIC 3: Road Graph, Zombie AI & Map Failure Fallback

### US-3.1: Load OSM road graph + Overpass failure fallback
- **Priority:** `[M]` | **Effort:** `5 pts`
- **Story:** As the system, I want walkable roads around the group so Zombies follow streets, with a non-blocking fallback if Overpass fails.
- **AC:**
  1. On Host Start, query Overpass radius **1200 m** around group centroid, `timeout: 8000 ms`.
  2. **Edge — timeout / 429 / network error:** Retry once on mirror (`overpass.kumi.systems` or `overpass-api.de`); total wait ≤ **10 s**.
  3. **Edge — still failing or `nodes.length === 0`:** Set `pathfinding_mode = 'DIRECT_VECTOR_FALLBACK'`, do **not** hang Start; show notice *"⚠️ Detailed road data busy — Zombies using free-move mode."*
  4. **Success:** Build directed graph `G(V, E)`; spawn 2 system Safe Zones at road nodes **150–300 m** from centroid; spawn initial Zombies on road nodes ≥ **80 m** from players.

### US-3.2: Five Zombie types + A* FSM loop
- **Priority:** `[M]` | **Effort:** `5 pts`
- **Story:** As a player, I want five distinct Zombie behaviors that path on real streets.
- **AC:**
  1. Every **1000 ms** tick updates all Zombies through FSM (`IDLE`, `WANDER`, `INVESTIGATE`, `CHASE`, `SEARCH`, `ATTACK`, plus `SWARM` for screamer pull) with total CPU budget **≤ 15 ms**.
  2. When a `Screamer` enters `CHASE`, all other Zombies within **100 m** switch toward swarm target position via A*.
  3. When a player enters an active Safe Zone, Zombies targeting them leave `CHASE`/`ATTACK` for `SEARCH`/`WANDER` at zone edge.
  4. With graph present, movement edges only follow OSM graph (no building/water clip). Vector fallback only when graph missing.

---

## EPIC 4: Survival, Rescue & Disconnection

### US-4.1: Knockdown 60 s, rescue hold 3 s, auto-respawn penalty
- **Priority:** `[M]` | **Effort:** `5 pts`
- **Story:** As a downed player, I want 60 s for a teammate rescue or a penalized Safe Zone respawn.
- **AC:**
  1. **Knockdown:** `hp <= 0` → `state = 'KNOCKED'`, `knocked_at = NOW()`, start **60 s** countdown; Zombies drop this target.
  2. **Solo shortcut:** If room has exactly 1 player, end match immediately (`ALL_KNOCKED`).
  3. **Rescue:** ALIVE teammate distance **≤ 10.0 m** enables **[🆘 Rescue]**; hold **3.0 s** continuous (both stay ≤ 10 m) → RPC `attempt_rescue`: victim `ALIVE`, `hp = 50`, `knocked_at = NULL`, rescuer `rescues_count += 1`.
  4. **Auto-respawn:** At 0 s remaining: `max_hp = max(20, max_hp - 20)`, `hp = max_hp`, `state = 'ALIVE'`, respawn/mark at nearest Safe Zone.
  5. **All knocked:** When 100% of connected players are `KNOCKED` (and not solo-shortcut already ended), end match `ALL_KNOCKED`.

### US-4.2: Disconnect grace 90 s + Host migration
- **Priority:** `[S]` | **Effort:** `5 pts`
- **Story:** As a group on flaky 4G, I want a 90 s ghost grace and automatic Host handoff if the Host drops.
- **AC:**
  1. No telemetry/heartbeat for **10 s** → `state = 'DISCONNECTED'`, freeze last position, zombies ignore target.
  2. Reconnect within **90 s** → restore prior state (`ALIVE`/`KNOCKED`) and stats (`hp`, `max_hp`, `distance_m`).
  3. Past **90 s** → remove from active end-condition set (no soft-lock of match end).
  4. **Host migration:** If disconnected player was Host for **> 15 s**, promote earliest-joined remaining `ALIVE` player to `host_player_id` (tick + End button rights transfer).

---

## EPIC 5: End Match, Summary & Play Again

### US-5.1: End match (all knocked / Host stop)
- **Priority:** `[M]` | **Effort:** `2 pts`
- **Story:** As Host or team, I want the match to end on full wipe or manual stop and show stats.
- **AC:**
  1. **Condition A:** At tick boundary, 100% connected players `state === 'KNOCKED'` → end `ALL_KNOCKED`.
  2. **Condition B:** Host confirms **[🛑 End match]** → end `HOST_ENDED`.
  3. Persist `match_results` row; broadcast `MATCH_ENDED`; all clients show Summary.

### US-5.2: Rematch in same room
- **Priority:** `[S]` | **Effort:** `2 pts`
- **Story:** As a group, I want one tap to replay without a new code.
- **AC:**
  1. Host taps **[🔄 Rematch]** on Summary → room returns to `WAITING` (same `room_code`), clears `started_at`/`ended_at`, deletes old `safe_zones` and zombie world state.
  2. Reset all `room_players`: `hp = 100`, `max_hp = 100`, `state = 'ALIVE'`, `distance_m = 0`, `max_speed_ms = 0`, `rescues_count = 0`, `knocked_at = NULL`.
  3. All clients return to Lobby ready for Start.

### US-5.3: Rejoin active room by player_id
- **Priority:** `[S]` | **Effort:** `2 pts`
- **Story:** As a player who refreshed or reopened the link, I want back into my live match.
- **AC:**
  1. **Given** existing member `player_id`, **When** join/rejoin called with same id, **Then** allow even if `status === 'ACTIVE'`.
  2. Receive full `world_state_tick` snapshot on channel join (players, zombies, safe zones, elapsed).
  3. **Given** unknown `player_id` and `ACTIVE`, **Then** `403 MATCH_ALREADY_STARTED`.

### US-5.4: Fetch match result
- **Priority:** `[C]` | **Effort:** `1 pt`
- **Story:** As a player, I want to reopen the last summary stats after leaving the room screen.
- **AC:**
  1. `GET /api/matches/{room_id}` returns stored `match_results` or `404`.
  2. Response includes `duration_sec`, `end_reason`, `summary_json`.

---

## Backlog Summary

| Epic | Stories | MoSCoW mix | Points |
| --- | --- | --- | --- |
| 1 Onboarding & Lobby | US-1.1 → US-1.3 | 3 M | **6** |
| 2 GPS, Wake Lock, Simulator | US-2.1 → US-2.3 | 2 M, 1 S | **7** |
| 3 OSM Graph & Zombie AI | US-3.1 → US-3.2 | 2 M | **10** |
| 4 Survival, Rescue, Disconnect | US-4.1 → US-4.2 | 1 M, 1 S | **10** |
| 5 End, Summary, Rematch, Rejoin | US-5.1 → US-5.4 | 2 M, 1 S, 1 C | **7** |
| **TOTAL** | **14 stories** | **10 M, 3 S, 1 C** | **40 pts** |

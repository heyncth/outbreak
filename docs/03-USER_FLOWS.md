# 03 · USER FLOWS & STATE TRANSITION TABLES (v2.0)

**Format:** Numbered prose steps only (no ASCII diagrams) + formal state transition matrices.

---

## PART A: BUSINESS WORKFLOWS

### Flow 1: Quick access, GPS permission & session init
- **Trigger:** Player opens the PWA link on a mobile browser.
- **Steps:**
  1. System checks `localStorage` key `outbreak_player_session`. If `player_id` and `nickname` exist, prefill nickname; otherwise create `player_id` (UUID v4) when a valid nickname (2–20 chars) is submitted.
  2. On **[Create room]** or **[Join room]**, browser calls `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy: true`, `timeout: 5000`.
  3. **Success branch:** Valid `{ latitude, longitude, accuracy }` unlocks the corresponding room API call.
  4. **Error branch 1 — denied (`error.code === 1`):** Show modal with Chrome/Safari location re-enable steps; block navigation until **[Re-check GPS]** succeeds.
  5. **Error branch 2 — unavailable/timeout (`error.code === 2 | 3`):** Retry up to 3 times; then show *"No GPS signal. Move outdoors."*

### Flow 2: Create room, join room & 10-player capacity
- **Trigger:** Player has GPS and taps Create or enters a 6-char code.
- **Steps:**
  1. **Create:** Client `POST /api/rooms/create` with `{ player_id, nickname, lat, lng }`. Server inserts `game_rooms` as `WAITING`, unique `room_code`, `host_player_id = player_id`, inserts Host into `room_players`.
  2. **Join:** Client `POST /api/rooms/join` with `{ room_code, player_id, nickname, lat, lng }`.
  3. **Server guards:**
     - Unknown code → `HTTP 404` `ROOM_NOT_FOUND`.
     - `player_id` already in room → allow rejoin (any `WAITING` or `ACTIVE`).
     - `status !== 'WAITING'` and new player → `HTTP 403` `MATCH_ALREADY_STARTED`.
     - Current count ≥ 10 → `HTTP 409` `ROOM_FULL`.
  4. Client subscribes Supabase Realtime channel `room:{room_code}`, renders roster `n/10` and preview map dots.

### Flow 3: Match start, OSM graph load & map fallback
- **Trigger:** Host taps **[Start survival]** in Lobby.
- **Steps:**
  1. Each client requests `navigator.wakeLock.request('screen')` in `try/catch`. On failure show `WakeLock: Off` and periodic-tap hint.
  2. Server computes group centroid `(lat0, lng0)`, sets `status = 'ACTIVE'`, `started_at = NOW()`.
  3. `osmGraph.ts` HTTP-calls primary Overpass for walkable `highway` ways within **1200 m**, `timeout: 8000`.
  4. **OSM success:** Convert nodes/ways to directed `G(V, E)`; spawn 2 system Safe Zones at road nodes **150–300 m** from centroid; spawn first wave on road nodes ≥ **80 m** from players.
  5. **OSM fallback:** Retry once on mirror; if fail or empty graph within **10 s** total, set `pathfinding_mode = 'DIRECT_VECTOR_FALLBACK'`, show *"⚠️ Road data busy — Zombies in free-move mode."*, still start match.

### Flow 4: GPS movement loop, noise & Zombie damage (core loop)
- **Trigger:** Room `ACTIVE`.
- **Steps:**
  1. On `watchPosition` fix with displacement ≥ **2.5 m** or every **1000 ms**, client computes `v = Δs / Δt` (m/s).
  2. **Sanity:** If `v > 12.0 m/s`, mark `SPEED_ANOMALY`, skip adding Δs to score, show warning.
  3. **Noise:** Map `v` → `0.05 / 0.20 / 0.60 / 1.00` (see US-2.1); send `player_telemetry` on Realtime.
  4. Every **1000 ms** host tick: distance matrix players × zombies; safe-zone membership.
  5. If distance ≤ `R_detect = R_base + (noise × 45 m)` (LOS-adjusted), Zombie → `CHASE` via A*.
  6. If distance ≤ **3.5 m**, Zombie → `ATTACK`, apply DPS to target HP each second (unless target in Safe Zone).

### Flow 5: Knockdown 60 s, rescue & auto-respawn
- **Trigger:** A player's `hp` reaches `0`.
- **Steps:**
  1. Player `ALIVE` → `KNOCKED`; `knocked_at = NOW()`; start **60 s** timer; Zombies drop target.
  2. If no connected `ALIVE` teammate remains (and not solo shortcut), go to Flow 8 all-knocked end.
  3. **Rescue branch:** ALIVE teammate ≤ **10.0 m** enables hold button; hold **3.0 s** with distance maintained → RPC `attempt_rescue`: victim `ALIVE`, `hp = 50`, clear `knocked_at`, rescuer `rescues_count += 1`.
  4. **Timeout branch:** At 0 s: `max_hp = max(20, max_hp - 20)`, `hp = max_hp`, `ALIVE`, respawn/mark nearest Safe Zone.
  5. **Solo branch:** Exactly 1 player in room → immediate end (`ALL_KNOCKED`).

### Flow 6: Safe Zone interaction & Host temporary zone
- **Trigger:** Player enters a Safe Zone radius, or Host taps **[🛡️ Create Safe Zone]**.
- **Steps:**
  1. **Host create:** Host `ALIVE`, not on **10 min** cooldown → insert `safe_zones` at Host position: `zone_type = 'HOST_CREATED'`, `radius_m = 30`, `expires_at = NOW() + 180 s`.
  2. **Enter zone:** Each tick, if distance to zone center ≤ `radius_m` and not expired → `in_safe_zone = true`.
  3. **Effects:** Heal **+2 HP/s** up to `max_hp`; all Zombies targeting this player leave `CHASE`/`ATTACK` for edge `SEARCH`/`WANDER`.
  4. **Expire:** After `expires_at`, zone removed; occupants `in_safe_zone = false`.

### Flow 7: Disconnect grace 90 s & Host migration
- **Trigger:** Player locks screen, loses 4G, or closes tab during `ACTIVE`.
- **Steps:**
  1. No telemetry **10 s** → `DISCONNECTED`, `disconnected_at = NOW()`.
  2. During **90 s** grace: character frozen at last coord, temporarily ignored by Zombies.
  3. **Host case:** If player was Host and disconnected **> 15 s**, promote earliest-joined remaining `ALIVE` player to `host_player_id` (AI tick + End rights).
  4. **Reconnect < 90 s:** Restore pre-disconnect state (`ALIVE`/`KNOCKED`) and stats.
  5. **> 90 s:** Mark out of active session so end-condition cannot soft-lock.

### Flow 8: End match, summary & rematch
- **Trigger:** (a) All connected players `KNOCKED`, or (b) Host confirms **[🛑 End match]**.
- **Steps:**
  1. Stop AI tick; `status = 'ENDED'`; `ended_at = NOW()`.
  2. Aggregate duration, `end_reason`, per-player `distance_m`, `max_speed_ms`, `rescues_count`, tech metrics → insert `match_results`.
  3. Broadcast `game_action: MATCH_ENDED`; release Wake Lock; show Summary Screen.
  4. **Rematch:** Host **[🔄 Rematch]** → `status = 'WAITING'`, clear start/end timestamps, delete old `safe_zones`/zombies; reset all player stats to defaults; return all clients to Lobby.

### Flow 9: Dev GPS simulator
- **Trigger:** Runtime devsim flag on (`?devsim=1`).
- **Steps:**
  1. `useGPS` detects flag; Dev panel can bypass hardware watcher.
  2. **Shift+Click** map or **WASD** produces `{ lat, lng }` at slider speed `0.0–6.0 m/s`.
  3. Simulated coords enter the same `player_telemetry` pipeline as real GPS (noise, A*, knockdown, rescue, host migration testable in multi-tab).

---

## PART B: FORMAL STATE TRANSITION TABLES

### B1. Room state (`game_rooms.status`)

| Current | Event | Guard | Next | System side effects |
| --- | --- | --- | --- | --- |
| *(none)* | `CREATE_ROOM` | Valid nickname + GPS granted | **`WAITING`** | Unique `room_code`, set `host_player_id`, open Realtime channel |
| **`WAITING`** | `PLAYER_JOIN` | Count ≤ 9 before insert | **`WAITING`** | Insert `room_players`, broadcast lobby update |
| **`WAITING`** | `START_MATCH` | Caller is `host_player_id` | **`ACTIVE`** | `started_at = NOW()`, load OSM, spawn zones/zombies, wake lock |
| **`ACTIVE`** | `ALL_PLAYERS_KNOCKED` | 100% connected players `KNOCKED` | **`ENDED`** | Stop tick, save `match_results` (`ALL_KNOCKED`), release wake lock |
| **`ACTIVE`** | `HOST_END_MATCH` | Caller is current `host_player_id` | **`ENDED`** | Stop tick, save `match_results` (`HOST_ENDED`), release wake lock |
| **`ENDED`** | `PLAY_AGAIN_REMATCH` | Caller is current `host_player_id` | **`WAITING`** | Reset `room_players` to defaults, clear zombies/zones, reopen lobby |
| **`ACTIVE`** | `HOST_MIGRATION` | Host heartbeat lost > 15 s | **`ACTIVE`** | Promote next ALIVE earliest joiner; transfer tick ownership |

### B2. Player state (`room_players.state`)

| Current | Event | Guard | Next | System side effects |
| --- | --- | --- | --- | --- |
| *(joined)* | `MATCH_STARTED` | Room `ACTIVE` | **`ALIVE`** | `hp = 100`, `max_hp = 100`, start distance/noise tracking |
| **`ALIVE`** | `ZOMBIE_DAMAGE` | `hp` after damage still > 0 | **`ALIVE`** | Decrease `hp`, red flash + vibrate alert |
| **`ALIVE`** | `ENTER_SAFE_ZONE` | dist ≤ `radius_m`, zone unexpired | **`ALIVE`** | `in_safe_zone = true`, +2 HP/s, block zombie attacks |
| **`ALIVE`** | `HP_DEPLETED` | `hp` ≤ 0 | **`KNOCKED`** | `knocked_at = NOW()`, 60 s countdown, drop zombie targets |
| **`KNOCKED`** | `TEAMMATE_RESCUE` | ALIVE rescuer ≤ 10 m holds 3 s before 60 s | **`ALIVE`** | `hp = 50`, clear `knocked_at`, `rescues_count += 1` |
| **`KNOCKED`** | `KNOCKDOWN_TIMEOUT` | 60 s elapsed, ≥1 ALIVE teammate exists | **`ALIVE`** | `max_hp = max(20, max_hp - 20)`, `hp = max_hp`, nearest Safe Zone |
| **`KNOCKED`** | `SOLO_WIPE` | Room player count = 1 | **`KNOCKED`** | Immediately end match `ALL_KNOCKED` |
| **`ALIVE`/`KNOCKED`** | `HEARTBEAT_LOST` | No packet > 10 s | **`DISCONNECTED`** | Freeze position, ignore as target; Host path may migrate at 15 s |
| **`DISCONNECTED`** | `RECONNECTED` | Valid packet within 90 s | **`ALIVE`/`KNOCKED`** | Restore prior state and `hp`/`max_hp`/`distance_m` |
| **`DISCONNECTED`** | `GRACE_EXPIRED` | > 90 s | **`DISCONNECTED`** | Exclude from active end-condition set |

### B3. Zombie FSM (`ZombieState`)

| Current | Event | Guard | Next | AI behavior |
| --- | --- | --- | --- | --- |
| **`IDLE`** | `SPAWN_TIMER_READY` | ≥ 2 s after spawn on road node | **`WANDER`** | Pick random adjacent graph node; walk at `wanderSpeed` |
| **`WANDER`** | `NOISE_SPIKE_HEARD` | Noise source at `R_detect < d ≤ 1.4 × R_detect` | **`INVESTIGATE`** | Store noise coords; A* to investigate |
| **`WANDER`/`INVESTIGATE`/`SEARCH`** | `TARGET_DETECTED` | Dist to ALIVE player outside Safe Zone ≤ `R_detect` | **`CHASE`** | Set `targetPlayerId`, `chaseSpeed`, re-path A* per tick rules; Screamer also emits SWARM ≤ 100 m |
| **`WANDER`/`INVESTIGATE`** | `SCREAMER_CALL` | Swarm signal within 100 m | **`SWARM`** | A* toward screamer-designated coords |
| **`SWARM`** | `TARGET_IN_SIGHT` | Dist ≤ `R_detect` | **`CHASE`** | Switch to direct pursuit |
| **`CHASE`** | `IN_MELEE_RANGE` | Dist ≤ 3.5 m | **`ATTACK`** | Apply type DPS while in range |
| **`ATTACK`** | `TARGET_ESCAPED_RANGE` | 3.5 m < dist ≤ `R_detect` | **`CHASE`** | Continue pursuit |
| **`CHASE`/`ATTACK`** | `TARGET_LOST_OR_SAFE` | dist > `R_detect` OR target in Safe Zone | **`SEARCH`** | Remember `lastKnownPos`; search ≤ 15 s |
| **`CHASE`/`ATTACK`** | `TARGET_KNOCKED_OR_DC` | Target `KNOCKED` or `DISCONNECTED` | **`WANDER`** | Clear target; pick other ALIVE or wander |
| **`SEARCH`/`INVESTIGATE`** | `SEARCH_TIMEOUT` | At last known pos for 15 s, no reacquire | **`WANDER`** | Clear memory; resume patrol |
| **any** | `TARGET_ATTACKED_IN_MELEE` | Victim entered Safe Zone mid-attack | **`SEARCH`** | Abort attack immediately |

---

## Notes for implementers

- Priority order for zombie transition evaluation (prevents CHASE↔SEARCH loops):  
  **target invalid / in safe zone → melee range → screamer alert → detect → noise spike → timers**
- Solo rooms short-circuit Flow 5 step 5 before 60 s wait.
- Part B is the single source of truth for guards; Part A explains UX around the same rules.

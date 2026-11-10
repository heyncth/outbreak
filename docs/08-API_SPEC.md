# 08 · API & REALTIME CONTRACTS (v2.0)

**Base URL:** same-origin Next.js App Router  
**Auth (MVP):** trust client-supplied `player_id` (UUID). Documented shortcut — see AGENTS ban list for what this does *not* allow.  
**Content-Type:** `application/json`  
**Errors:** unified schema (§1).

---

## 1. Unified error schema

```json
{
  "error": {
    "code": "ROOM_FULL",
    "message": "Room is full (max 10 players).",
    "details": { "count": 10, "limit": 10 }
  }
}
```

### 1.1 HTTP status map

| Status | Codes |
| --- | --- |
| 400 | `INVALID_NICKNAME`, `INVALID_ROOM_CODE`, `INVALID_COORDS`, `VALIDATION_ERROR` |
| 403 | `MATCH_ALREADY_STARTED`, `NOT_HOST`, `FORBIDDEN` |
| 404 | `ROOM_NOT_FOUND`, `MATCH_NOT_FOUND`, `PLAYER_NOT_FOUND` |
| 409 | `ROOM_FULL`, `ROOM_CONFLICT` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR`, `OVERPASS_FAILED` (if proxied) |
| 503 | `DB_UNAVAILABLE` |

---

## 2. Rate limits (per player_id unless noted)

| Endpoint / channel | Limit |
| --- | --- |
| `POST /api/rooms/create` | 10 / min |
| `POST /api/rooms/join` | 20 / min |
| `POST /api/rooms/start` | 10 / min |
| `POST /api/rooms/end` | 5 / min |
| `POST /api/rooms/rematch` | 5 / min |
| `POST /api/rooms/safe-zone` | 1 / 10 min (cooldown server-checked) |
| `POST /api/rescue` | 5 / min |
| `GET /api/matches/:roomId` | 30 / min |
| Broadcast `player_telemetry` | **client-side 1 Hz hard throttle** |

Exceeded → `429` + `RATE_LIMITED`.

---

## 3. REST endpoints

### 3.1 `POST /api/rooms/create`

**Request**
```json
{
  "nickname": "ThuanHuy",
  "player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "lat": 16.054407,
  "lng": 108.202167
}
```

**Response `201`**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "room_code": "OB8421",
  "player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "is_host": true,
  "status": "WAITING"
}
```

**Errors:** `400 INVALID_NICKNAME` | `400 INVALID_COORDS` | `429 RATE_LIMITED`

**JSON Schema (response)**
```json
{
  "type": "object",
  "required": ["room_id", "room_code", "player_id", "is_host", "status"],
  "properties": {
    "room_id": { "type": "string", "format": "uuid" },
    "room_code": { "type": "string", "pattern": "^[A-Z2-9]{6}$" },
    "player_id": { "type": "string", "format": "uuid" },
    "is_host": { "type": "boolean" },
    "status": { "enum": ["WAITING", "ACTIVE", "ENDED"] }
  }
}
```

---

### 3.2 `POST /api/rooms/join`

**Request**
```json
{
  "room_code": "OB8421",
  "nickname": "DienThang",
  "player_id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  "lat": 16.054450,
  "lng": 108.202210
}
```

**Response `200`**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "player_id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  "is_host": false,
  "status": "WAITING",
  "rejoined": false
}
```

**Rejoin:** same `player_id` already in room → `rejoined: true`, allowed even if `ACTIVE`.

**Errors:** `404 ROOM_NOT_FOUND` | `403 MATCH_ALREADY_STARTED` | `409 ROOM_FULL` | `400 INVALID_ROOM_CODE`

**Schema join response**
```json
{
  "type": "object",
  "required": ["room_id", "player_id", "is_host", "status", "rejoined"],
  "properties": {
    "room_id": { "type": "string", "format": "uuid" },
    "player_id": { "type": "string", "format": "uuid" },
    "is_host": { "type": "boolean" },
    "status": { "enum": ["WAITING", "ACTIVE", "ENDED"] },
    "rejoined": { "type": "boolean" }
  }
}
```

---

### 3.3 `GET /api/rooms/:code`

Lobby / rejoin snapshot.

**Response `200`**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "room_code": "OB8421",
  "status": "WAITING",
  "host_player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "center_lat": 16.054407,
  "center_lng": 108.202167,
  "player_count": 4,
  "players": [
    {
      "player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "nickname": "ThuanHuy",
      "state": "ALIVE",
      "hp": 100,
      "max_hp": 100
    }
  ]
}
```

**Errors:** `404 ROOM_NOT_FOUND`

---

### 3.4 `POST /api/rooms/start`

Host only. Sets `ACTIVE`, triggers OSM fetch (server or host-side per architecture), returns tick config.

**Request**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "requester_player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

**Response `200`**
```json
{
  "status": "ACTIVE",
  "started_at": "2026-11-10T12:00:00.000Z",
  "center_lat": 16.054407,
  "center_lng": 108.202167,
  "pathfinding_mode": "GRAPH_ASTAR",
  "zombie_density": "MEDIUM"
}
```

**Errors:** `403 NOT_HOST` | `404 ROOM_NOT_FOUND` | `409 ROOM_CONFLICT` (not WAITING) | `500 OVERPASS_FAILED` only if fallback also disabled (normally still 200 with `DIRECT_VECTOR_FALLBACK`)

**pathfinding_mode enum:** `GRAPH_ASTAR` | `DIRECT_VECTOR_FALLBACK`

---

### 3.5 `POST /api/rooms/end`

**Request**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "requester_player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "reason": "HOST_ENDED"
}
```

**reason enum:** `HOST_ENDED` | `ALL_KNOCKED`  
**ALL_KNOCKED** may be invoked by host tick machinery with service role; Host UI only sends `HOST_ENDED`.

**Response `200`**
```json
{
  "status": "ENDED",
  "ended_at": "2026-11-10T12:20:00.000Z",
  "end_reason": "HOST_ENDED",
  "match_id": "..."
}
```

**Errors:** `403 NOT_HOST` (for HOST_ENDED) | `404 ROOM_NOT_FOUND` | `409 ROOM_CONFLICT`

---

### 3.6 `POST /api/rooms/rematch`

**Request**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "requester_player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

**Response `200`**
```json
{
  "status": "WAITING",
  "room_code": "OB8421",
  "reset_player_count": 4
}
```

**Side effects:** clear start/end, delete `safe_zones`, reset all `room_players` stats, broadcast rematch.

**Errors:** `403 NOT_HOST` | `404` | `409` (must be ENDED)

---

### 3.7 `POST /api/rooms/safe-zone`

Host only; 10 min server cooldown.

**Request**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "requester_player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "lat": 16.054512,
  "lng": 108.202310
}
```

**Response `201`**
```json
{
  "zone_id": "…uuid…",
  "zone_type": "HOST_CREATED",
  "radius_m": 30,
  "expires_at": "2026-11-10T12:23:00.000Z",
  "cooldown_until": "2026-11-10T12:33:00.000Z"
}
```

**Errors:** `403 NOT_HOST` | `429 RATE_LIMITED` (cooldown) | `400 INVALID_COORDS`

---

### 3.8 `POST /api/rescue`

Delegates to `attempt_rescue` RPC.

**Request**
```json
{
  "rescuer_id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  "victim_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

**Response `200`**
```json
{ "rescued": true, "victim_hp": 50, "victim_state": "ALIVE" }
```

**Response `200` (no-op)**
```json
{ "rescued": false, "reason": "TOO_FAR_OR_INVALID" }
```

**Errors:** `404 PLAYER_NOT_FOUND` | `429`

---

### 3.9 `GET /api/matches/:roomId`

**Response `200`**
```json
{
  "room_id": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "duration_sec": 940,
  "end_reason": "HOST_ENDED",
  "summary_json": { },
  "created_at": "2026-11-10T12:20:00.000Z"
}
```

**Errors:** `404 MATCH_NOT_FOUND`

---

## 4. Supabase Realtime channel contracts

**Channel name:** `room:{room_code}`  
**Transport:** Broadcast (ephemeral; not Postgres changes for 1 Hz data)

### 4.1 `player_telemetry` (client → host, ≤ 1 Hz)

```json
{
  "type": "broadcast",
  "event": "player_telemetry",
  "payload": {
    "player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "lat": 16.054512,
    "lng": 108.202310,
    "speed_ms": 2.4,
    "noise_level": 0.6,
    "distance_delta_m": 2.4,
    "accuracy_m": 6.5,
    "flags": [],
    "timestamp": 1762742000123
  }
}
```

**flags[] enum:** `LOW_ACCURACY` | `SPEED_ANOMALY` | `DEV_SIMULATED`

**Schema**
```json
{
  "type": "object",
  "required": ["player_id", "lat", "lng", "speed_ms", "noise_level", "distance_delta_m", "timestamp"],
  "properties": {
    "player_id": { "type": "string", "format": "uuid" },
    "lat": { "type": "number", "minimum": -90, "maximum": 90 },
    "lng": { "type": "number", "minimum": -180, "maximum": 180 },
    "speed_ms": { "type": "number", "minimum": 0, "maximum": 12 },
    "noise_level": { "type": "number", "minimum": 0.05, "maximum": 1 },
    "distance_delta_m": { "type": "number", "minimum": 0 },
    "accuracy_m": { "type": "number", "minimum": 0 },
    "flags": { "type": "array", "items": { "type": "string" } },
    "timestamp": { "type": "integer" }
  }
}
```

### 4.2 `world_state_tick` (host → all, 1 Hz)

```json
{
  "type": "broadcast",
  "event": "world_state_tick",
  "payload": {
    "tick_id": 185,
    "elapsed_sec": 185,
    "pathfinding_mode": "GRAPH_ASTAR",
    "players": [
      {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "nickname": "ThuanHuy",
        "lat": 16.054512,
        "lng": 108.202310,
        "hp": 85,
        "max_hp": 100,
        "state": "ALIVE",
        "noise": 0.6,
        "in_safe_zone": false,
        "knocked_remaining_sec": null
      }
    ],
    "zombies": [
      {
        "id": "z_01",
        "type": "RUNNER",
        "state": "CHASE",
        "lat": 16.054390,
        "lng": 108.202190,
        "heading_deg": 45,
        "target_player_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
      }
    ],
    "safe_zones": [
      {
        "id": "sz_01",
        "zone_type": "SYSTEM",
        "lat": 16.055000,
        "lng": 108.203000,
        "radius_m": 30,
        "expires_in_sec": null
      }
    ]
  }
}
```

**zombie.type enum:** `WALKER` | `RUNNER` | `STALKER` | `SCREAMER` | `BRUTE`  
**zombie.state enum:** `IDLE` | `WANDER` | `INVESTIGATE` | `CHASE` | `SEARCH` | `ATTACK` | `SWARM`

**Player state enum:** `ALIVE` | `KNOCKED` | `DISCONNECTED`

### 4.3 `game_action`

```json
{
  "type": "broadcast",
  "event": "game_action",
  "payload": {
    "action": "RESCUE | AUTO_RESPAWN | SPAWN_SAFE_ZONE | MATCH_ENDED | HOST_MIGRATED | REMATCH",
    "actor_player_id": "…",
    "data": { }
  }
}
```

| action | data highlights |
| --- | --- |
| `RESCUE` | `victim_id`, `victim_hp` |
| `AUTO_RESPAWN` | `player_id`, `new_max_hp`, `zone_id?` |
| `SPAWN_SAFE_ZONE` | full zone object |
| `MATCH_ENDED` | `end_reason`, `match_id` |
| `HOST_MIGRATED` | `new_host_player_id` |
| `REMATCH` | `status: WAITING` |

Clients apply UI only; authoritative world remains host tick.

### 4.4 `heartbeat` (client → host, every 5 s during ACTIVE)

```json
{
  "event": "heartbeat",
  "payload": { "player_id": "…", "timestamp": 1762742000123 }
}
```

Missing > 10 s → server/host marks `DISCONNECTED`. Host missing > 15 s → `HOST_MIGRATED`.

---

## 5. Sequence notes

1. create/join → subscribe channel → lobby snapshots via `GET /api/rooms/:code` + broadcast roster updates (optional `lobby_state` event at 1 Hz only in WAITING).
2. start → REST → host builds graph → first `world_state_tick`.
3. telemetry → host applies → tick → clients render (LERP).
4. end → REST → `MATCH_ENDED` → summary REST GET for persistence display.

---

## 6. CORS / security headers

- Same-origin only for MVP (PWA served from one deployment).
- Service role key never exposed to client; only anon key in `NEXT_PUBLIC_*`.
- Optional: verify `Origin` on mutating routes.

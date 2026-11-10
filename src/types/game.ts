export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlayerTelemetry {
  player_id: string;
  lat: number;
  lng: number;
  speed_ms: number;
  noise_level: number;
  distance_delta_m: number;
  accuracy_m: number;
  flags: TelemetryFlag[];
  timestamp: number;
}

export type TelemetryFlag = "LOW_ACCURACY" | "SPEED_ANOMALY" | "DEV_SIMULATED";

export type RoomStatus = "WAITING" | "ACTIVE" | "ENDED";
export type PlayerState = "ALIVE" | "KNOCKED" | "DISCONNECTED";

export interface RoomPlayer {
  player_id: string;
  nickname: string;
  state: PlayerState;
  hp: number;
  max_hp: number;
  distance_m?: number;
  max_speed_ms?: number;
}

export interface RoomSnapshot {
  room_id: string;
  room_code: string;
  status: RoomStatus;
  host_player_id: string;
  center_lat: number | null;
  center_lng: number | null;
  player_count: number;
  players: RoomPlayer[];
}

export type ZombieType = "WALKER" | "RUNNER" | "STALKER" | "SCREAMER" | "BRUTE";
export type ZombieState = "IDLE" | "WANDER" | "INVESTIGATE" | "CHASE" | "SEARCH" | "ATTACK" | "SWARM";
export type PathfindingModeLike = "GRAPH_ASTAR" | "DIRECT_VECTOR_FALLBACK";

export interface ZombieTick {
  id: string;
  type: ZombieType;
  state: ZombieState;
  lat: number;
  lng: number;
  heading_deg: number;
  target_player_id: string | null;
}

export interface WorldStateTick {
  tick_id: number;
  elapsed_sec: number;
  pathfinding_mode: PathfindingModeLike;
  players: (RoomPlayer & {
    lat: number;
    lng: number;
    noise: number;
    in_safe_zone: boolean;
    knocked_remaining_sec: number | null;
  })[];
  zombies: ZombieTick[];
  safe_zones: SafeZoneTick[];
}

export interface SafeZoneTick {
  id: string;
  zone_type: "SYSTEM" | "HOST_CREATED";
  lat: number;
  lng: number;
  radius_m: number;
  expires_in_sec: number | null;
}

export type GameActionName =
  | "RESCUE"
  | "AUTO_RESPAWN"
  | "SPAWN_SAFE_ZONE"
  | "MATCH_ENDED"
  | "HOST_MIGRATED"
  | "REMATCH";

export interface GameActionEvent {
  action: GameActionName;
  actor_player_id: string | null;
  data: Record<string, unknown>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type EndReason = "HOST_ENDED" | "ALL_KNOCKED";

export interface MatchPlayerStat {
  player_id: string;
  nickname: string;
  distance_m: number;
  max_speed_ms: number;
  rescues_count: number;
  max_hp: number;
  state: PlayerState;
}

export interface MatchSummaryJson {
  tech_metrics: {
    pathfinding_mode?: PathfindingModeLike;
    avg_gps_accuracy_m?: number;
    wake_lock_drops?: number;
  };
  gameplay_metrics: {
    match_duration_sec: number;
    total_team_distance_m: number;
    total_knockdowns: number;
    successful_rescues: number;
    auto_respawns_at_safezone: number;
    end_reason: EndReason;
  };
  players: MatchPlayerStat[];
}

export interface MatchResultResponse {
  room_id: string;
  duration_sec: number;
  end_reason: EndReason;
  summary_json: MatchSummaryJson;
  created_at: string;
}

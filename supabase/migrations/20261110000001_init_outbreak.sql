-- migration: 20261110000001_init_outbreak.sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enums
CREATE TYPE room_status AS ENUM ('WAITING', 'ACTIVE', 'ENDED');
CREATE TYPE player_state AS ENUM ('ALIVE', 'KNOCKED', 'DISCONNECTED');

-- Rooms
CREATE TABLE public.game_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(6) UNIQUE NOT NULL,
    host_player_id UUID NOT NULL,
    status room_status NOT NULL DEFAULT 'WAITING',
    center_lat DOUBLE PRECISION,
    center_lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Players in room
CREATE TABLE public.room_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    nickname VARCHAR(30) NOT NULL,
    hp INT NOT NULL DEFAULT 100 CHECK (hp >= 0),
    max_hp INT NOT NULL DEFAULT 100 CHECK (max_hp >= 20 AND max_hp <= 100),
    state player_state NOT NULL DEFAULT 'ALIVE',
    location GEOGRAPHY(Point, 4326),
    noise_level REAL NOT NULL DEFAULT 0.05,
    distance_m DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    max_speed_ms REAL NOT NULL DEFAULT 0.0,
    rescues_count INT NOT NULL DEFAULT 0,
    knocked_at TIMESTAMPTZ,
    disconnected_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, player_id)
);

-- Safe zones
CREATE TABLE public.safe_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL DEFAULT 'Safe Zone',
    zone_type VARCHAR(20) NOT NULL DEFAULT 'SYSTEM', -- SYSTEM | HOST_CREATED
    center GEOGRAPHY(Point, 4326) NOT NULL,
    radius_m REAL NOT NULL DEFAULT 30.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- Match results (1 row per finished match per room lifecycle)
CREATE TABLE public.match_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID UNIQUE NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
    duration_sec INT NOT NULL,
    end_reason VARCHAR(30) NOT NULL, -- ALL_KNOCKED | HOST_ENDED
    summary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rooms_code ON public.game_rooms(room_code);
CREATE INDEX idx_rooms_status ON public.game_rooms(status);
CREATE INDEX idx_players_room ON public.room_players(room_id);
CREATE INDEX idx_players_player_id ON public.room_players(player_id);
CREATE INDEX idx_players_geo ON public.room_players USING GIST(location);
CREATE INDEX idx_safezones_room ON public.safe_zones(room_id);
CREATE INDEX idx_safezones_geo ON public.safe_zones USING GIST(center);

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rooms_updated_at
  BEFORE UPDATE ON public.game_rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_players_updated_at
  BEFORE UPDATE ON public.room_players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Capacity guard: max 10 per room
CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.room_players WHERE room_id = NEW.room_id;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'ROOM_FULL' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_room_capacity
  BEFORE INSERT ON public.room_players
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_capacity();

-- RPC: attempt rescue (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.attempt_rescue(
  p_rescuer_id UUID,
  p_victim_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dist DOUBLE PRECISION;
  v_victim_state player_state;
  v_room_id UUID;
BEGIN
  SELECT v.room_id, v.state, ST_Distance(r.location, v.location)
  INTO v_room_id, v_victim_state, v_dist
  FROM public.room_players r
  JOIN public.room_players v ON v.room_id = r.room_id
  WHERE r.id = p_rescuer_id
    AND v.id = p_victim_id
    AND r.state = 'ALIVE';

  IF v_victim_state IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_victim_state = 'KNOCKED' AND v_dist <= 10.0 THEN
    UPDATE public.room_players
    SET state = 'ALIVE', hp = 50, knocked_at = NULL
    WHERE id = p_victim_id;

    UPDATE public.room_players
    SET rescues_count = rescues_count + 1
    WHERE id = p_rescuer_id;

    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- RPC: join room with capacity + status guards (used by API layer)
CREATE OR REPLACE FUNCTION public.join_room(
  p_room_code VARCHAR(6),
  p_player_id UUID,
  p_nickname VARCHAR(30),
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
) RETURNS TABLE(room_id UUID, player_row_id UUID, is_host BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_existing UUID;
  v_count INT;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE room_code = p_room_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT rp.id INTO v_existing FROM public.room_players rp
  WHERE rp.room_id = v_room.id AND rp.player_id = p_player_id;

  IF v_existing IS NOT NULL THEN
    -- rejoin allowed
    RETURN QUERY SELECT v_room.id, v_existing, (v_room.host_player_id = p_player_id);
    RETURN;
  END IF;

  IF v_room.status <> 'WAITING' THEN
    RAISE EXCEPTION 'MATCH_ALREADY_STARTED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.room_players rp WHERE rp.room_id = v_room.id;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'ROOM_FULL' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.room_players (room_id, player_id, nickname, location)
  VALUES (v_room.id, p_player_id, p_nickname, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
  RETURNING id INTO v_existing;

  RETURN QUERY SELECT v_room.id, v_existing, false;
END;
$$;

-- RPC: end match (host or all-knocked path helper)
CREATE OR REPLACE FUNCTION public.end_match(
  p_room_id UUID,
  p_reason VARCHAR(30)
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started TIMESTAMPTZ;
BEGIN
  SELECT started_at INTO v_started FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  UPDATE public.game_rooms
  SET status = 'ENDED', ended_at = NOW()
  WHERE id = p_room_id AND status = 'ACTIVE';

  IF FOUND THEN
    INSERT INTO public.match_results (room_id, duration_sec, end_reason, summary_json)
    VALUES (
      p_room_id,
      GREATEST(0, COALESCE(EXTRACT(EPOCH FROM (NOW() - v_started))::INT, 0)),
      p_reason,
      '[]'::jsonb
    )
    ON CONFLICT (room_id) DO NOTHING;
  END IF;
END;
$$;

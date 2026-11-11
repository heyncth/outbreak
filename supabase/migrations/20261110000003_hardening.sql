-- hardening: rescue id fix, atomic end summary, join tokens, RLS, grants

-- 1. per-player join token (client proves identity on privileged routes)
ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS join_token UUID NOT NULL DEFAULT gen_random_uuid();

-- 2. rescue: match by player_id within same room (client always sends player_id)
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
  v_victim_row UUID;
  v_rescuer_row UUID;
BEGIN
  SELECT v.id, v.state, ST_Distance(r.location, v.location), r.id
  INTO v_victim_row, v_victim_state, v_dist, v_rescuer_row
  FROM public.room_players r
  JOIN public.room_players v ON v.room_id = r.room_id
  WHERE r.player_id = p_rescuer_id
    AND v.player_id = p_victim_id
    AND r.state = 'ALIVE'
  ORDER BY r.joined_at DESC
  LIMIT 1;

  IF v_victim_row IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_victim_state = 'KNOCKED' AND v_dist <= 10.0 THEN
    UPDATE public.room_players
    SET state = 'ALIVE', hp = 50, knocked_at = NULL
    WHERE id = v_victim_row;

    UPDATE public.room_players
    SET rescues_count = rescues_count + 1
    WHERE id = v_rescuer_row;

    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- 3. touch locations by player_id (same mismatch fix)
CREATE OR REPLACE FUNCTION public.touch_rescue_locations(
  p_rescuer_id UUID,
  p_rescuer_lat DOUBLE PRECISION,
  p_rescuer_lng DOUBLE PRECISION,
  p_victim_id UUID,
  p_victim_lat DOUBLE PRECISION,
  p_victim_lng DOUBLE PRECISION
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.room_players
  SET location = ST_SetSRID(ST_MakePoint(p_rescuer_lng, p_rescuer_lat), 4326)::geography,
      updated_at = NOW()
  WHERE player_id = p_rescuer_id;

  UPDATE public.room_players
  SET location = ST_SetSRID(ST_MakePoint(p_victim_lng, p_victim_lat), 4326)::geography,
      updated_at = NOW()
  WHERE player_id = p_victim_id;
END;
$$;

-- 4. end_match writes summary atomically (no separate update to lose)
DROP FUNCTION IF EXISTS public.end_match(UUID, VARCHAR);
CREATE FUNCTION public.end_match(
  p_room_id UUID,
  p_reason VARCHAR(30),
  p_summary JSONB DEFAULT NULL
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
      COALESCE(p_summary, '[]'::jsonb)
    )
    ON CONFLICT (room_id) DO UPDATE SET
      duration_sec = EXCLUDED.duration_sec,
      end_reason = EXCLUDED.end_reason,
      summary_json = EXCLUDED.summary_json;
  END IF;
END;
$$;

-- 5. RLS: enable, no policies → anon/authenticated denied all rows
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safe_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;

-- 6. functions callable only by service_role (all app calls go through serverClient)
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

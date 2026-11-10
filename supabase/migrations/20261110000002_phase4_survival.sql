-- Phase 4: rescue live location touch + host zone insert helpers
-- DOWN
-- DROP FUNCTION IF EXISTS public.touch_rescue_locations(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, DOUBLE PRECISION, DOUBLE PRECISION);
-- DROP FUNCTION IF EXISTS public.create_host_zone(UUID, DOUBLE PRECISION, DOUBLE PRECISION, REAL, INT);

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
  WHERE id = p_rescuer_id;

  UPDATE public.room_players
  SET location = ST_SetSRID(ST_MakePoint(p_victim_lng, p_victim_lat), 4326)::geography,
      updated_at = NOW()
  WHERE id = p_victim_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_host_zone(
  p_room_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_m REAL DEFAULT 30.0,
  p_ttl_sec INT DEFAULT 180
) RETURNS TABLE(zone_id UUID, zone_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires TIMESTAMPTZ := NOW() + make_interval(secs => p_ttl_sec);
  v_new_id UUID;
BEGIN
  INSERT INTO public.safe_zones (room_id, name, zone_type, center, radius_m, expires_at)
  VALUES (
    p_room_id,
    'Safe Zone',
    'HOST_CREATED',
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_radius_m,
    v_expires
  )
  RETURNING public.safe_zones.id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_expires;
END;
$$;

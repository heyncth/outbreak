-- rescue hardening: locations are owner-written only (rescuer in route,
-- victim via heartbeat) — the shared unscoped touch RPC is unused now

DROP FUNCTION IF EXISTS public.touch_rescue_locations(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, DOUBLE PRECISION, DOUBLE PRECISION);

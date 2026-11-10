-- supabase/seed.sql
INSERT INTO public.game_rooms (room_code, host_player_id, status, center_lat, center_lng)
VALUES (
  'DEMOAB',
  '00000000-0000-4000-8000-000000000001',
  'WAITING',
  16.054407,
  108.202167
);

INSERT INTO public.room_players (room_id, player_id, nickname, location)
SELECT id, '00000000-0000-4000-8000-000000000001', 'SeedHost',
       ST_SetSRID(ST_MakePoint(108.202167, 16.054407), 4326)::geography
FROM public.game_rooms WHERE room_code = 'DEMOAB';

-- Migration 1215: traffic_sessions click-signal columns for Meta Conversions API.
--
-- The browser tracking script (src/app/api/traffic/script/route.ts) now captures
-- the Facebook click identifiers and forwards client IP / user-agent so the
-- server-side CAPI sender can build high-match user_data:
--   fbc                 — _fbc cookie or reconstructed "fb.1.<ts>.<fbclid>"
--   fbp                 — _fbp pixel cookie (browser-generated; not reconstructable)
--   fbclid              — raw click id from the ad URL
--   client_ip_address   — captured server-side from x-forwarded-for at ingest
--   client_user_agent   — captured server-side from the request UA at ingest
--
-- These feed Meta's user_data match keys. Nullable + additive — existing rows and
-- the ingest path keep working unchanged when no Pixel/click data is present.

ALTER TABLE public.traffic_sessions
  ADD COLUMN IF NOT EXISTS fbc                text,
  ADD COLUMN IF NOT EXISTS fbp                text,
  ADD COLUMN IF NOT EXISTS fbclid             text,
  ADD COLUMN IF NOT EXISTS client_ip_address  text,
  ADD COLUMN IF NOT EXISTS client_user_agent  text;

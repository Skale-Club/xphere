-- Migration 1143: allow 'available' status on ads_connections
-- The "Manage ad accounts" feature and the Meta/Google OAuth callbacks store
-- hidden-but-connected accounts as status='available'. The original
-- constraint (migration 1108) only allowed 'active'/'error'/'revoked', so
-- saving a selection (or connecting accounts) raised
-- ads_connections_status_check violations. Add 'available' to the allowed set.

ALTER TABLE public.ads_connections
  DROP CONSTRAINT IF EXISTS ads_connections_status_check;

ALTER TABLE public.ads_connections
  ADD CONSTRAINT ads_connections_status_check
  CHECK (status IN ('active', 'available', 'error', 'revoked'));

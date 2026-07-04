-- =============================================================================
-- Migration 1243: Composite index on call_logs for direction filtering (SEED-048 Phase E)
--
-- idx_call_logs_org_date (org_id, started_at DESC) does not cover the `direction`
-- filter applied by getUnifiedCalls() (src/app/(dashboard)/calls/actions.ts) when
-- filters.direction !== 'all'. This is a database-only index addition — no Calls
-- code file is modified by this migration.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_call_logs_org_direction_date
  ON public.call_logs (org_id, direction, started_at DESC);

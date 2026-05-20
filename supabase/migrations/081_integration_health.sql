-- =============================================================================
-- Migration 081: Integration Health Columns (SEED-025 Phase A)
-- =============================================================================
-- Adds health-tracking columns to `integrations` so the SEED-025 Phase D
-- health validator can flip integrations between connected/degraded/disconnected
-- and the workflow builder (manual + AI) can filter out unavailable capabilities.
-- =============================================================================

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS health_status   text         NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('connected', 'degraded', 'disconnected', 'unknown')),
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error      text,
  ADD COLUMN IF NOT EXISTS failure_count   integer      NOT NULL DEFAULT 0;

-- The workflow builder queries by health_status to filter the integration
-- palette; partial index keeps that path cheap.
CREATE INDEX IF NOT EXISTS idx_integrations_health
  ON public.integrations (organization_id, health_status)
  WHERE is_active = true;

-- =============================================================================
-- Migration: 033_automation_schedules
-- Phase: v1.9 GHL Lost-Lead Reengagement (SMS) — Phase 32
-- Creates: automation_schedules (single-row schedule registry per automation_key)
-- RLS:     Enabled but NO POLICY → only service-role can read/write (D-32-07)
-- Seed:    'ghl_reengagement_sms' next_run_at = next 14:00 UTC, interval_minutes = 1440 (daily)
-- Pattern source: 32-RESEARCH.md Pattern 9
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.automation_schedules (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key     TEXT         NOT NULL UNIQUE,
  is_active          BOOLEAN      NOT NULL DEFAULT true,
  next_run_at        TIMESTAMPTZ  NOT NULL,
  interval_minutes   INTEGER      NOT NULL CHECK (interval_minutes > 0),
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT         CHECK (last_run_status IN ('success','error','skipped')),
  last_run_result    JSONB,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Single-tenant for v1.9: no org_id. RLS enabled with NO policy locks the table
-- to service-role server code only (matches D-32-07).
ALTER TABLE public.automation_schedules ENABLE ROW LEVEL SECURITY;

-- updated_at trigger (use the project-wide helper public.update_updated_at,
-- referenced from migration 027 and earlier).
CREATE TRIGGER trg_automation_schedules_updated_at
  BEFORE UPDATE ON public.automation_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Seed row for v1.9 reengagement automation.
-- next_run_at = next 14:00 UTC (≈ 11:00 BRT). interval_minutes = 1440 (daily).
INSERT INTO public.automation_schedules (automation_key, is_active, next_run_at, interval_minutes)
VALUES (
  'ghl_reengagement_sms',
  true,
  (date_trunc('day', now()) + interval '1 day 14 hours'),
  1440
)
ON CONFLICT (automation_key) DO NOTHING;

COMMENT ON TABLE public.automation_schedules IS
  'Phase 32 (v1.9): DB-backed schedule registry. GitHub Actions pulses every 15min; runner reads next_run_at to decide whether to dispatch. UPDATE to change schedule without redeploy.';

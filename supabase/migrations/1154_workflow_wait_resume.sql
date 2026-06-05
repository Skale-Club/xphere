-- 1129_workflow_wait_resume.sql
-- Make "wait for event" functional: allow a workflow run to suspend at a wait
-- node and resume when a correlated event arrives (or on timeout).
--
-- Reuses the workflow_waits table reserved in 075_workflow_engine.sql, adding
-- the columns the engine needs to correlate and resume.

-- 1. Allow runs to sit in a 'waiting' state.
ALTER TABLE public.workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
ALTER TABLE public.workflow_runs ADD CONSTRAINT workflow_runs_status_check
  CHECK (status IN ('queued','running','succeeded','failed','cancelled','waiting'));

-- 2. Extend workflow_waits for correlation + resume.
ALTER TABLE public.workflow_waits
  ADD COLUMN IF NOT EXISTS org_id       uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS node_id      text,
  ADD COLUMN IF NOT EXISTS event_type   text,
  ADD COLUMN IF NOT EXISTS contact_id   uuid,
  ADD COLUMN IF NOT EXISTS timed_out_at timestamptz;

-- 3. Fast lookup for "which pending waits match this event for this contact".
CREATE INDEX IF NOT EXISTS workflow_waits_pending_event_idx
  ON public.workflow_waits (org_id, event_type, contact_id)
  WHERE satisfied_at IS NULL;

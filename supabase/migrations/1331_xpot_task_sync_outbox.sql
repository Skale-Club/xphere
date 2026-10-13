-- Durable Xphere -> Xpot task delivery. The trigger captures every writer
-- (dashboard, MCP, Copilot, workflows, imports) instead of relying on each
-- application path to remember an integration callback.
CREATE TABLE IF NOT EXISTS public.xpot_task_sync_outbox (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_xpot_task_sync_outbox_due
  ON public.xpot_task_sync_outbox (status, next_attempt_at, id)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.xpot_task_sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enqueue_xpot_task_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_data public.tasks;
  op text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  op := CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END;

  -- Xpot mirror inserts and callbacks advance external_updated_at. They are
  -- acknowledgements, not new local edits, so do not send them back.
  IF TG_OP = 'INSERT' AND (NEW.external_source = 'xpot' OR NEW.external_updated_at IS NOT NULL) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.external_updated_at IS DISTINCT FROM OLD.external_updated_at THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND
     (NEW.title, NEW.description, NEW.due_date, NEW.priority, NEW.status, NEW.assigned_to, NEW.entity_type, NEW.entity_id)
     IS NOT DISTINCT FROM
     (OLD.title, OLD.description, OLD.due_date, OLD.priority, OLD.status, OLD.assigned_to, OLD.entity_type, OLD.entity_id)
  THEN RETURN NEW; END IF;

  INSERT INTO public.xpot_task_sync_outbox (org_id, task_id, operation, payload)
  VALUES (
    row_data.org_id,
    row_data.id,
    op,
    jsonb_build_object(
      'id', row_data.id,
      'title', row_data.title,
      'description', row_data.description,
      'due_date', row_data.due_date,
      'priority', row_data.priority,
      'status', row_data.status,
      'assigned_to', row_data.assigned_to,
      'entity_type', row_data.entity_type,
      'entity_id', row_data.entity_id,
      'external_source', row_data.external_source,
      'external_id', row_data.external_id,
      -- DELETE has no BEFORE UPDATE timestamp bump; use deletion time so it
      -- sorts after the last upsert instead of being rejected as equally old.
      'updated_at', CASE WHEN TG_OP = 'DELETE' THEN now() ELSE row_data.updated_at END
    )
  );
  RETURN row_data;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_xpot_sync ON public.tasks;
CREATE TRIGGER trg_tasks_xpot_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_xpot_task_sync();

REVOKE ALL ON public.xpot_task_sync_outbox FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_xpot_task_sync() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_xpot_task_sync(batch_size integer DEFAULT 25)
RETURNS SETOF public.xpot_task_sync_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.xpot_task_sync_outbox
    WHERE status IN ('pending', 'processing') AND next_attempt_at <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(batch_size, 100))
  )
  UPDATE public.xpot_task_sync_outbox outbox
  SET status = 'processing',
      attempt_count = outbox.attempt_count + 1,
      next_attempt_at = now() + interval '5 minutes'
  FROM candidates
  WHERE outbox.id = candidates.id
  RETURNING outbox.*;
$$;

REVOKE ALL ON FUNCTION public.claim_xpot_task_sync(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_xpot_task_sync(integer) TO service_role;

-- One-time backfill: existing native Xphere tasks enter the same reliable
-- pipeline. Xpot-origin mirrors are already present on both sides.
INSERT INTO public.xpot_task_sync_outbox (org_id, task_id, operation, payload)
SELECT
  task.org_id,
  task.id,
  'upsert',
  jsonb_build_object(
    'id', task.id,
    'title', task.title,
    'description', task.description,
    'due_date', task.due_date,
    'priority', task.priority,
    'status', task.status,
    'assigned_to', task.assigned_to,
    'entity_type', task.entity_type,
    'entity_id', task.entity_id,
    'external_source', task.external_source,
    'external_id', task.external_id,
    'updated_at', task.updated_at
  )
FROM public.tasks task
WHERE task.external_source IS DISTINCT FROM 'xpot';

-- =============================================================================
-- Migration 1332: Xpot is a per-org integration
-- =============================================================================
-- Xphere -> Xpot used one global connection (XPOT_API_URL / XPOT_API_KEY env)
-- and the 1331 trigger queued the tasks of EVERY org for it, so all tenants'
-- tasks landed on the same Xpot user. Xpot now has its own tenant, and the
-- connection lives where Xkedule's does: Settings -> Integrations -> Xpot.
--
--   integration_provider     gains 'xpot' (Xpot URL in location_id, the Xpot
--                            user's inbound key in encrypted_api_key).
--   enqueue_xpot_task_sync   queues a task only when its org has an active
--                            Xpot integration.
--   xpot_task_sync_outbox    rows still waiting from orgs without one are
--                            closed as failed (not deleted), with the reason.
--
-- Idempotent: ADD VALUE IF NOT EXISTS / CREATE OR REPLACE / guarded UPDATE.
-- =============================================================================

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'xpot';

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

  -- Only orgs that connected Xpot send it their tasks. provider is compared as
  -- text because the enum value is added in this same migration.
  IF NOT EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.organization_id = row_data.org_id
      AND i.provider::text = 'xpot'
      AND i.is_active
  ) THEN RETURN row_data; END IF;

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

UPDATE public.xpot_task_sync_outbox outbox
SET status = 'failed',
    last_error = 'Skipped: this org has no Xpot integration (migration 1332).',
    processed_at = now()
WHERE outbox.status IN ('pending', 'processing')
  AND NOT EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.organization_id = outbox.org_id
      AND i.provider::text = 'xpot'
      AND i.is_active
  );

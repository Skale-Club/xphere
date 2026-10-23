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
--   xpot_task_sync_outbox    a BEFORE INSERT guard drops events of orgs with no
--                            active Xpot integration, so 1331's task trigger
--                            stays as it is and queues only connected orgs.
--                            Rows already waiting for other orgs are closed as
--                            failed (not deleted), with the reason.
--
-- provider is compared as text because the enum value is added in this same
-- migration. Idempotent: ADD VALUE IF NOT EXISTS / CREATE OR REPLACE /
-- DROP TRIGGER IF EXISTS / guarded UPDATE.
-- =============================================================================

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'xpot';

CREATE OR REPLACE FUNCTION public.org_has_xpot(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.organization_id = p_org_id
      AND i.provider::text = 'xpot'
      AND i.is_active
  );
$$;

REVOKE ALL ON FUNCTION public.org_has_xpot(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.skip_xpot_sync_without_integration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.org_has_xpot(NEW.org_id) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.skip_xpot_sync_without_integration() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_xpot_task_sync_outbox_org_guard ON public.xpot_task_sync_outbox;
CREATE TRIGGER trg_xpot_task_sync_outbox_org_guard
  BEFORE INSERT ON public.xpot_task_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.skip_xpot_sync_without_integration();

UPDATE public.xpot_task_sync_outbox
SET status = 'failed',
    last_error = 'Skipped: this org has no Xpot integration (migration 1332).',
    processed_at = now()
WHERE status IN ('pending', 'processing')
  AND NOT public.org_has_xpot(org_id);

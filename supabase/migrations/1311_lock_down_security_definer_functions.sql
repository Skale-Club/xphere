-- Migration 1311: lock down SECURITY DEFINER functions exposed through /rpc.
-- Idempotent.
--
-- SECURITY DEFINER functions run as their owner and bypass RLS, and Supabase
-- grants EXECUTE on new public functions to anon + authenticated by default, so
-- each one is callable through PostgREST /rpc with only the public anon key.
--
-- 1) Server-only functions: callers are the service-role client (knowledge
--    search, Zernio webhook, integration-health edge function, admin audit
--    refresh), other SECURITY DEFINER functions, or triggers. None takes a
--    caller-scoped org check, e.g. match_documents returned every org's
--    knowledge chunks to anyone with the anon key. Revoke from every API role.
--    Trigger functions never need EXECUTE at fire time.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.match_documents(vector,jsonb)',
    'public.next_agent_prompt_version(uuid)',
    'public.fn_seed_default_pipeline_for_org(uuid)',
    'public.get_tag_usage(uuid)',
    'public.mark_workflows_blocked_by_integration(uuid,text)',
    'public.clear_workflows_blocked_by_integration(uuid)',
    'public.refresh_contact_duplicate_audit()',
    'public._is_cluster_fully_excluded(uuid,uuid[])',
    'public.merge_zernio_channel_only_contact(uuid,uuid,uuid,text[])',
    'public.trg_agent_prompt_version_snapshot()',
    'public.fn_call_log_to_opportunity_activity()',
    'public.fn_org_default_pipeline()',
    'public.invalidate_conversation_reads()',
    'public.sync_conversation_preview_from_message()',
    'public.resolve_merged_conversation_contact()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 2) User-facing functions that resolve the caller via auth.uid(): signed-in
--    users keep access, the anonymous key does not.
REVOKE EXECUTE ON FUNCTION public.merge_contacts(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_org_member_profiles(uuid,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_permission(text) FROM PUBLIC, anon;

-- 3) merge_contacts only checked that both contacts share an org, not that the
--    caller belongs to it, so any signed-in user could merge another tenant's
--    contacts by id. Body below is the live definition plus the tenant guard.
CREATE OR REPLACE FUNCTION public.merge_contacts(survivor_id uuid, archived_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  survivor_org uuid;
  archived_org uuid;
  survivor_status text;
  archived_status text;
  caller_uid uuid := auth.uid();
BEGIN
  IF survivor_id = archived_id THEN
    RAISE EXCEPTION 'merge_contacts: survivor and archived must differ';
  END IF;

  SELECT org_id, identity_status INTO survivor_org, survivor_status
    FROM public.contacts WHERE id = survivor_id FOR UPDATE;
  IF survivor_org IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: survivor % not found', survivor_id;
  END IF;

  SELECT org_id, identity_status INTO archived_org, archived_status
    FROM public.contacts WHERE id = archived_id FOR UPDATE;
  IF archived_org IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: archived % not found', archived_id;
  END IF;

  IF survivor_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: survivor % is already archived', survivor_id;
  END IF;
  IF archived_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: % is already archived', archived_id;
  END IF;

  IF survivor_org <> archived_org THEN
    RAISE EXCEPTION 'merge_contacts: cross-org merge not allowed (% vs %)', survivor_org, archived_org;
  END IF;

  -- Tenant guard (1311): SECURITY DEFINER bypasses RLS, so the function must
  -- itself prove the caller may touch survivor_org.
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.org_members m
       WHERE m.organization_id = survivor_org AND m.user_id = caller_uid
    )
  ) THEN
    RAISE EXCEPTION 'merge_contacts: not allowed for org %', survivor_org
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.bookings           SET linked_contact_id = survivor_id WHERE linked_contact_id = archived_id;
  UPDATE public.call_logs          SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.conversations      SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.opportunities      SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.analytics_events   SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.analytics_visitors SET contact_id        = survivor_id WHERE contact_id        = archived_id;

  INSERT INTO public.contact_tags (contact_id, tag_id, tagged_at, tagged_by)
    SELECT survivor_id, tag_id, tagged_at, tagged_by
      FROM public.contact_tags WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.contact_tags WHERE contact_id = archived_id;

  INSERT INTO public.opportunity_contacts (org_id, opportunity_id, contact_id, is_primary)
    SELECT org_id, opportunity_id, survivor_id, is_primary
      FROM public.opportunity_contacts WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.opportunity_contacts WHERE contact_id = archived_id;

  UPDATE public.contacts
     SET identity_status        = 'archived_duplicate',
         merged_into_contact_id = survivor_id,
         updated_at             = now()
   WHERE id = archived_id;

  INSERT INTO public.contact_merge_log
    (org_id, survivor_id, archived_id, merged_by, merged_at, strategy)
  VALUES
    (survivor_org, survivor_id, archived_id, caller_uid, now(), 'manual');
END;
$function$;

-- RLS helper functions (get_current_org_id, current_org_role, is_demo_session,
-- member_org_ids, ...) stay executable by anon on purpose: policies on tables
-- reachable by anon call them, and they only describe the caller.

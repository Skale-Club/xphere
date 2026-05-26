-- Probe D — Happy path: 8 FK tables, dedupe proofs for join tables, audit log, cleanup.
-- Pre-author schema scan (2026-05-25) revealed these additional NOT NULL columns
-- (beyond what the plan's inline SQL specified) that must be supplied:
--   bookings:      event_type_id, booker_name, booker_email, start_at, end_at
--   call_logs:     call_sid, direction
--   conversations: widget_token
--   opportunities: pipeline_id, stage_id, title
--   opportunity_contacts: (no extras)
--   tags:          slug
--   traffic_events:    organization_id (NOT org_id), event_type
--   traffic_visitors:  organization_id (NOT org_id), visitor_key
--   event_types FK seed: org_id, user_id, title, slug
--   pipelines FK seed:   org_id, name
--   pipeline_stages FK seed: pipeline_id, org_id, name, position
DO $$
DECLARE
  v_org uuid;
  v_user uuid;
  v_tag uuid := gen_random_uuid();
  v_survivor uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid();
  v_booking uuid := gen_random_uuid();
  v_call uuid := gen_random_uuid();
  v_conv uuid := gen_random_uuid();
  v_opp uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_visitor uuid := gen_random_uuid();
  v_event_type uuid := gen_random_uuid();
  v_pipeline uuid := gen_random_uuid();
  v_stage uuid := gen_random_uuid();
  v_log_count int;
  v_check int;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;

  -- ============================================================
  -- Pre-seed FK parents (event_type, pipeline, stage)
  -- ============================================================
  INSERT INTO public.event_types (id, org_id, user_id, title, slug)
    VALUES (v_event_type, v_org, v_user, 'probe-d-event-type', 'probe-d-event-type-' || replace(v_event_type::text, '-', ''));
  INSERT INTO public.pipelines (id, org_id, name)
    VALUES (v_pipeline, v_org, 'probe-d-pipeline-' || replace(v_pipeline::text, '-', ''));
  INSERT INTO public.pipeline_stages (id, pipeline_id, org_id, name, position)
    VALUES (v_stage, v_pipeline, v_org, 'probe-d-stage', 0);

  -- Insert two synthetic contacts in same org
  INSERT INTO public.contacts (id, org_id, phone, identity_status)
    VALUES (v_survivor, v_org, '+15550100100', 'identified'),
           (v_archived, v_org, '+15550100100', 'identified');

  -- Seed a tag (requires slug)
  INSERT INTO public.tags (id, org_id, name, slug)
    VALUES (v_tag, v_org, 'probe-d-tag', 'probe-d-tag-' || replace(v_tag::text, '-', ''));

  -- ============================================================
  -- Insert 1 row per FK table pointing at v_archived (8 tables total)
  -- ============================================================

  -- 1. bookings.linked_contact_id
  INSERT INTO public.bookings (id, org_id, linked_contact_id, event_type_id, booker_name, booker_email, start_at, end_at)
    VALUES (v_booking, v_org, v_archived, v_event_type, 'Probe D', 'probe-d@example.test', now(), now() + interval '30 min');

  -- 2. call_logs.contact_id
  INSERT INTO public.call_logs (id, org_id, contact_id, call_sid, direction)
    VALUES (v_call, v_org, v_archived, 'PROBE-D-' || replace(v_call::text, '-', ''), 'inbound');

  -- 3. contact_tags(contact_id, tag_id) — JOIN TABLE
  --    PRE-SEED survivor side too so we can prove ON CONFLICT DO NOTHING + DELETE behavior.
  INSERT INTO public.contact_tags (contact_id, tag_id)
    VALUES (v_survivor, v_tag),
           (v_archived, v_tag);

  -- 4. conversations.contact_id
  INSERT INTO public.conversations (id, org_id, contact_id, widget_token)
    VALUES (v_conv, v_org, v_archived, 'probe-d-wt-' || replace(v_conv::text, '-', ''));

  -- 5. opportunities.contact_id
  INSERT INTO public.opportunities (id, org_id, contact_id, pipeline_id, stage_id, title)
    VALUES (v_opp, v_org, v_archived, v_pipeline, v_stage, 'probe-d-opportunity');

  -- 6. opportunity_contacts(org_id, opportunity_id, contact_id, is_primary) — JOIN TABLE
  --    PRE-SEED survivor A on SAME opportunity_id as the row we'll merge from B.
  INSERT INTO public.opportunity_contacts (org_id, opportunity_id, contact_id, is_primary)
    VALUES (v_org, v_opp, v_survivor, true),
           (v_org, v_opp, v_archived, false);

  -- 7. traffic_events.contact_id (organization_id, not org_id)
  INSERT INTO public.traffic_events (id, organization_id, contact_id, event_type)
    VALUES (v_event, v_org, v_archived, 'form_submit');

  -- 8. traffic_visitors.contact_id (organization_id, not org_id)
  INSERT INTO public.traffic_visitors (id, organization_id, contact_id, visitor_key)
    VALUES (v_visitor, v_org, v_archived, 'probe-d-vk-' || replace(v_visitor::text, '-', ''));

  -- ============================================================
  -- Execute merge
  -- ============================================================
  PERFORM public.merge_contacts(v_survivor, v_archived);

  -- ============================================================
  -- Assert ALL 8 FK rewrites
  -- ============================================================

  -- 1. bookings: linked_contact_id rewritten
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = v_booking AND linked_contact_id = v_survivor) THEN
    RAISE EXCEPTION 'bookings.linked_contact_id NOT rewritten';
  END IF;

  -- 2. call_logs: contact_id rewritten
  IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE id = v_call AND contact_id = v_survivor) THEN
    RAISE EXCEPTION 'call_logs.contact_id NOT rewritten';
  END IF;

  -- 3. contact_tags: archived row DELETED, survivor row preserved
  SELECT count(*) INTO v_check FROM public.contact_tags WHERE tag_id = v_tag AND contact_id = v_archived;
  IF v_check <> 0 THEN
    RAISE EXCEPTION 'contact_tags: archived rows NOT deleted (count=%)', v_check;
  END IF;
  SELECT count(*) INTO v_check FROM public.contact_tags WHERE tag_id = v_tag AND contact_id = v_survivor;
  IF v_check <> 1 THEN
    RAISE EXCEPTION 'contact_tags: expected exactly 1 survivor row for tag, got % (dedupe broken)', v_check;
  END IF;

  -- 4. conversations: contact_id rewritten
  IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv AND contact_id = v_survivor) THEN
    RAISE EXCEPTION 'conversations.contact_id NOT rewritten';
  END IF;

  -- 5. opportunities: contact_id rewritten
  IF NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id = v_opp AND contact_id = v_survivor) THEN
    RAISE EXCEPTION 'opportunities.contact_id NOT rewritten';
  END IF;

  -- 6. opportunity_contacts: B's row DELETED, A's preserved (Pitfall 4)
  SELECT count(*) INTO v_check FROM public.opportunity_contacts WHERE opportunity_id = v_opp AND contact_id = v_archived;
  IF v_check <> 0 THEN
    RAISE EXCEPTION 'opportunity_contacts: archived row NOT deleted (count=%)', v_check;
  END IF;
  SELECT count(*) INTO v_check FROM public.opportunity_contacts WHERE opportunity_id = v_opp AND contact_id = v_survivor;
  IF v_check <> 1 THEN
    RAISE EXCEPTION 'opportunity_contacts: expected exactly 1 survivor row, got % (ON CONFLICT DO NOTHING failed)', v_check;
  END IF;

  -- 7. traffic_events: contact_id rewritten
  IF NOT EXISTS (SELECT 1 FROM public.traffic_events WHERE id = v_event AND contact_id = v_survivor) THEN
    RAISE EXCEPTION 'traffic_events.contact_id NOT rewritten';
  END IF;

  -- 8. traffic_visitors: contact_id rewritten
  IF NOT EXISTS (SELECT 1 FROM public.traffic_visitors WHERE id = v_visitor AND contact_id = v_survivor) THEN
    RAISE EXCEPTION 'traffic_visitors.contact_id NOT rewritten';
  END IF;

  -- ============================================================
  -- Assert archived row marked + audit log written
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = v_archived
                  AND identity_status = 'archived_duplicate'
                  AND merged_into_contact_id = v_survivor) THEN
    RAISE EXCEPTION 'archived contact not properly marked';
  END IF;

  SELECT count(*) INTO v_log_count FROM public.contact_merge_log
    WHERE survivor_id = v_survivor AND archived_id = v_archived AND strategy = 'manual';
  IF v_log_count <> 1 THEN
    RAISE EXCEPTION 'contact_merge_log row missing or duplicated (count=%)', v_log_count;
  END IF;

  RAISE NOTICE 'PROBE D OK — all 8 FK tables asserted (bookings, call_logs, contact_tags [dedupe], conversations, opportunities, opportunity_contacts [dedupe], traffic_events, traffic_visitors)';

  -- ============================================================
  -- Cleanup — delete EVERY synthetic row so audit table isn't polluted
  -- ============================================================
  DELETE FROM public.contact_merge_log      WHERE survivor_id = v_survivor;
  DELETE FROM public.bookings               WHERE id = v_booking;
  DELETE FROM public.call_logs              WHERE id = v_call;
  DELETE FROM public.contact_tags           WHERE tag_id = v_tag;
  DELETE FROM public.tags                   WHERE id = v_tag;
  DELETE FROM public.conversations          WHERE id = v_conv;
  DELETE FROM public.opportunity_contacts   WHERE opportunity_id = v_opp;
  DELETE FROM public.opportunities          WHERE id = v_opp;
  DELETE FROM public.traffic_events         WHERE id = v_event;
  DELETE FROM public.traffic_visitors       WHERE id = v_visitor;
  DELETE FROM public.contacts               WHERE id IN (v_survivor, v_archived);
  DELETE FROM public.pipeline_stages        WHERE id = v_stage;
  DELETE FROM public.pipelines              WHERE id = v_pipeline;
  DELETE FROM public.event_types            WHERE id = v_event_type;

  RAISE NOTICE 'PROBE D CLEANUP OK — all synthetic rows deleted';
END $$;

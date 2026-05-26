-- Probe E — Guard: already-archived target
DO $$
DECLARE
  v_org uuid;
  v_survivor uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  INSERT INTO public.contacts (id, org_id, identity_status)
    VALUES (v_survivor, v_org, 'identified'),
           (v_archived, v_org, 'archived_duplicate');
  BEGIN
    PERFORM public.merge_contacts(v_survivor, v_archived);
    RAISE EXCEPTION 'did NOT reject already-archived target';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%already archived%' THEN
      RAISE NOTICE 'GUARD OK: already-archived target rejected';
    ELSE
      RAISE EXCEPTION 'Wrong error: %', SQLERRM;
    END IF;
  END;
  DELETE FROM public.contacts WHERE id IN (v_survivor, v_archived);
END $$;

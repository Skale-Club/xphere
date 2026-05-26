-- Probe F — Guard: cross-org
DO $$
DECLARE
  v_org_a uuid;
  v_org_b uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_org_a FROM public.organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO v_org_b FROM public.organizations ORDER BY created_at OFFSET 1 LIMIT 1;
  IF v_org_b IS NULL THEN
    RAISE NOTICE 'SKIP PROBE F: only one org in prod; cross-org guard cannot be tested without seeding';
    RETURN;
  END IF;
  INSERT INTO public.contacts (id, org_id, identity_status) VALUES (v_a, v_org_a, 'identified');
  INSERT INTO public.contacts (id, org_id, identity_status) VALUES (v_b, v_org_b, 'identified');
  BEGIN
    PERFORM public.merge_contacts(v_a, v_b);
    RAISE EXCEPTION 'did NOT reject cross-org merge';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%cross-org%' THEN
      RAISE NOTICE 'GUARD OK: cross-org rejected';
    ELSE
      RAISE EXCEPTION 'Wrong error: %', SQLERRM;
    END IF;
  END;
  DELETE FROM public.contacts WHERE id IN (v_a, v_b);
END $$;

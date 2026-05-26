-- Probe H — contact_merge_exclusions hides cluster
DO $$
DECLARE
  v_org uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_lo uuid; v_hi uuid;
  v_clusters int;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  INSERT INTO public.contacts (id, org_id, phone, identity_status) VALUES
    (v_a, v_org, '+15558888888', 'identified'),
    (v_b, v_org, '+15558888888', 'identified');
  v_lo := LEAST(v_a, v_b); v_hi := GREATEST(v_a, v_b);
  PERFORM public.refresh_contact_duplicate_audit();
  SELECT count(*) INTO v_clusters FROM public.contact_duplicate_audit WHERE normalized_value = '+15558888888';
  IF v_clusters <> 1 THEN
    RAISE EXCEPTION 'Setup failed: expected 1 cluster before exclusion, got %', v_clusters;
  END IF;
  INSERT INTO public.contact_merge_exclusions (org_id, contact_id_a, contact_id_b)
    VALUES (v_org, v_lo, v_hi);
  PERFORM public.refresh_contact_duplicate_audit();
  SELECT count(*) INTO v_clusters FROM public.contact_duplicate_audit WHERE normalized_value = '+15558888888';
  IF v_clusters <> 0 THEN
    RAISE EXCEPTION 'Exclusion did not hide cluster (still % clusters)', v_clusters;
  END IF;
  RAISE NOTICE 'PROBE H OK: exclusion hides cluster';
  DELETE FROM public.contact_merge_exclusions WHERE contact_id_a = v_lo AND contact_id_b = v_hi;
  DELETE FROM public.contacts WHERE id IN (v_a, v_b);
  PERFORM public.refresh_contact_duplicate_audit();
END $$;

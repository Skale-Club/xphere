-- Probe G — refresh excludes archived rows (Pitfall 6 regression)
DO $$
DECLARE
  v_org uuid;
  v_live uuid := gen_random_uuid();
  v_arch uuid := gen_random_uuid();
  v_clusters int;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  INSERT INTO public.contacts (id, org_id, phone, identity_status) VALUES
    (v_live, v_org, '+15559999999', 'identified'),
    (v_arch, v_org, '+15559999999', 'archived_duplicate');
  PERFORM public.refresh_contact_duplicate_audit();
  SELECT count(*) INTO v_clusters
    FROM public.contact_duplicate_audit
   WHERE normalized_value = '+15559999999';
  IF v_clusters <> 0 THEN
    RAISE EXCEPTION 'archived row formed cluster — Pitfall 6 NOT FIXED (clusters=%)', v_clusters;
  END IF;
  RAISE NOTICE 'PROBE G OK: archived rows excluded from cluster detection';
  DELETE FROM public.contacts WHERE id IN (v_live, v_arch);
  PERFORM public.refresh_contact_duplicate_audit();
END $$;

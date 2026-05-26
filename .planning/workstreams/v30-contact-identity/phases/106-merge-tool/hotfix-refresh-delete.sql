-- Hotfix: Replace TRUNCATE with DELETE in refresh_contact_duplicate_audit().
-- TRUNCATE was blocked by FK reference from contact_merge_log.cluster_id (introduced in 1057).
-- DELETE triggers the existing ON DELETE SET NULL action on dependent rows.
CREATE OR REPLACE FUNCTION public.refresh_contact_duplicate_audit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.contact_duplicate_audit;

  -- Phone duplicates (live contacts only, excluding fully-marked-separate clusters)
  INSERT INTO public.contact_duplicate_audit
    (org_id, match_type, normalized_value, contact_ids, cluster_size, detected_at)
  SELECT
    org_id,
    'phone',
    phone_e164,
    array_agg(id ORDER BY created_at),
    count(*)::int,
    now()
  FROM public.contacts
  WHERE phone_e164 IS NOT NULL
    AND identity_status <> 'archived_duplicate'
  GROUP BY org_id, phone_e164
  HAVING count(*) >= 2
     AND NOT public._is_cluster_fully_excluded(org_id, array_agg(id ORDER BY id));

  -- Email duplicates (live contacts only, excluding fully-marked-separate clusters)
  INSERT INTO public.contact_duplicate_audit
    (org_id, match_type, normalized_value, contact_ids, cluster_size, detected_at)
  SELECT
    org_id,
    'email',
    email_normalized,
    array_agg(id ORDER BY created_at),
    count(*)::int,
    now()
  FROM public.contacts
  WHERE email_normalized IS NOT NULL
    AND identity_status <> 'archived_duplicate'
  GROUP BY org_id, email_normalized
  HAVING count(*) >= 2
     AND NOT public._is_cluster_fully_excluded(org_id, array_agg(id ORDER BY id));
END;
$$;

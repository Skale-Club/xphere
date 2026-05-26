-- =============================================================================
-- Migration 1059: Contacts Unique Constraints (CID-07, CID-08)
-- (Originally drafted as 1058; renumbered to 1059 because 1058_mcp_oauth.sql
--  landed in main first. DDL is fully idempotent via IF NOT EXISTS.)
--
-- Phase 107 of v3.0 Contact Identity workstream. Adds two partial UNIQUE
-- indexes that enforce org-scoped phone and email uniqueness against live
-- (non-archived) contacts.
--
-- Depends on: 1056 (generated columns + identity_status), 1057 (merge tool +
-- refresh function with archived-row filter).
--
-- Safety: refreshes contact_duplicate_audit FIRST then raises EXCEPTION if any
-- cluster remains (D-05/D-05a). Forces operator to resolve via Phase 106 UI
-- before constraints can land. Baseline (per 106-AUDIT-BASELINE) = 0 clusters,
-- so this is a no-op against current prod data.
--
-- The partial index WHERE clause MUST stay textually equivalent to the
-- pre-check filter used in createContact and the three webhook handlers
-- (whatsapp/evolution/telegram). See Pitfall 1 in 107-RESEARCH.md.
-- =============================================================================

-- Section 1: refresh + guard (D-05 / D-05a)
DO $$
DECLARE
  cluster_count int;
BEGIN
  PERFORM public.refresh_contact_duplicate_audit();
  SELECT count(*) INTO cluster_count FROM public.contact_duplicate_audit;
  IF cluster_count > 0 THEN
    RAISE EXCEPTION
      'Migration 1059 aborted: % duplicate cluster(s) remain in contact_duplicate_audit. Resolve via /admin/contacts/conflicts before running.', cluster_count;
  END IF;
END $$;

-- Section 2: phone partial unique (CID-07) — D-05b plain CREATE atomic in tx
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_phone_uniq
  ON public.contacts (org_id, phone_e164)
  WHERE phone_e164 IS NOT NULL
    AND identity_status <> 'archived_duplicate';

COMMENT ON INDEX public.contacts_org_phone_uniq IS
  'Phase 107 CID-07: org-scoped phone uniqueness on normalized E.164. '
  'Excludes archived_duplicate so merged rows do not block survivors. '
  'WHERE clause MUST match the pre-check filter used in createContact + webhook handlers.';

-- Section 3: email partial unique (CID-08)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_email_uniq
  ON public.contacts (org_id, email_normalized)
  WHERE email_normalized IS NOT NULL
    AND identity_status <> 'archived_duplicate';

COMMENT ON INDEX public.contacts_org_email_uniq IS
  'Phase 107 CID-08: org-scoped email uniqueness on lower(trim(email)). '
  'Excludes archived_duplicate so merged rows do not block survivors. '
  'WHERE clause MUST match the pre-check filter used in createContact + webhook handlers.';

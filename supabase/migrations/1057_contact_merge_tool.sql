-- =============================================================================
-- Migration 1057: Contact Merge Tool (CID-04, CID-06)
--
-- Phase 106 of v3.0 Contact Identity workstream. Adds the schema and SQL
-- surface for manual contact merging. Auto-merge (CID-05) is DEFERRED per
-- 106-CONTEXT.md D-01.
--
-- Depends on migration 1056 (contact_identity_audit) — uses identity_status
-- column and refresh_contact_duplicate_audit() function defined there.
--
-- Scope:
--   * contacts.merged_into_contact_id self-FK (nullable, ON DELETE SET NULL)
--   * contact_merge_log table (audit trail; deny-all RLS, service role + SECURITY DEFINER only)
--   * contact_merge_exclusions table (mark-as-separate pairs, org admin RLS)
--   * merge_contacts(survivor_id, archived_id) SECURITY DEFINER function
--   * refresh_contact_duplicate_audit() REPLACED with exclusion-aware + identity_status filter
--   * _is_cluster_fully_excluded() helper
--
-- NOT in scope: auto-merge logic (deferred), UNIQUE constraints (Phase 107),
-- channel identities (Phase 108), invariant trigger (Phase 109).
--
-- Author-time verifications (vs PLAN inline SQL):
--   * contact_tags has NO org_id column (cols: contact_id, tag_id, tagged_at, tagged_by).
--     INSERT adjusted accordingly. PK = (contact_id, tag_id).
--   * opportunity_contacts column list confirmed: (org_id, opportunity_id, contact_id, is_primary).
--   * Membership table is `org_members` with `organization_id` (NOT `org_memberships`/`org_id`).
--     `role` is enum `public.user_role` with values ('admin','member'). Policy uses 'admin'.
-- =============================================================================

-- ----- Section 1: contacts.merged_into_contact_id ----------------------------
-- D-04a: nullable self-FK, ON DELETE SET NULL. Survivor's own row has NULL.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS merged_into_contact_id uuid
    REFERENCES public.contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contacts.merged_into_contact_id IS
  'When identity_status = archived_duplicate, points at the live survivor. '
  'Used by resolveLiveContactId() helper and merged-banner UI.';

CREATE INDEX IF NOT EXISTS idx_contacts_merged_into
  ON public.contacts (merged_into_contact_id)
  WHERE merged_into_contact_id IS NOT NULL;

-- ----- Section 2: contact_merge_log ------------------------------------------
-- RESEARCH.md Pattern 3. strategy enum includes 'auto' and 'import-dedup'
-- forward-compat even though only 'manual' is written in Phase 106.

CREATE TABLE IF NOT EXISTS public.contact_merge_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  survivor_id     uuid NOT NULL,
  archived_id     uuid NOT NULL,
  merged_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  merged_at       timestamptz NOT NULL DEFAULT now(),
  strategy        text NOT NULL CHECK (strategy IN ('manual','auto','import-dedup')),
  cluster_id      uuid REFERENCES public.contact_duplicate_audit(cluster_id) ON DELETE SET NULL,
  affected_rows   jsonb
);

CREATE INDEX IF NOT EXISTS idx_cml_org_merged_at ON public.contact_merge_log (org_id, merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_cml_survivor      ON public.contact_merge_log (survivor_id);
CREATE INDEX IF NOT EXISTS idx_cml_archived      ON public.contact_merge_log (archived_id);

ALTER TABLE public.contact_merge_log ENABLE ROW LEVEL SECURITY;
-- No policies: only service role + SECURITY DEFINER functions can read/write.

COMMENT ON TABLE public.contact_merge_log IS
  'Audit log of contact merges. Written by merge_contacts() SECURITY DEFINER. '
  'No RLS policies — only service role + SECURITY DEFINER access.';

-- ----- Section 3: contact_merge_exclusions -----------------------------------
-- RESEARCH.md Pattern 4. CHECK enforces canonical ordering (D-03a).

CREATE TABLE IF NOT EXISTS public.contact_merge_exclusions (
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id_a  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  contact_id_b  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  excluded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  excluded_at   timestamptz NOT NULL DEFAULT now(),
  reason        text,
  PRIMARY KEY (org_id, contact_id_a, contact_id_b),
  CHECK (contact_id_a < contact_id_b)
);

ALTER TABLE public.contact_merge_exclusions ENABLE ROW LEVEL SECURITY;

-- Authenticated members can SELECT within their active org.
CREATE POLICY contact_merge_exclusions_select
  ON public.contact_merge_exclusions FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- Only org admins (org_members.role = 'admin') can INSERT.
-- Author-time verified: membership table is `org_members` with `organization_id` (NOT `org_memberships`).
CREATE POLICY contact_merge_exclusions_insert
  ON public.contact_merge_exclusions FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_merge_exclusions.org_id
         AND role            = 'admin'
    )
  );

COMMENT ON TABLE public.contact_merge_exclusions IS
  'Pairs of contacts marked as "not duplicates". '
  'refresh_contact_duplicate_audit() hides clusters where every pairwise combination is excluded.';

-- ----- Section 4: merge_contacts() SECURITY DEFINER --------------------------
-- D-02 + RESEARCH.md Pattern 2 (CORRECTED — RESEARCH had typo on first SELECT INTO).
-- Explicit UPDATE per FK table (no dynamic SQL).
-- Verified 8-table FK list against prod 2026-05-25.

CREATE OR REPLACE FUNCTION public.merge_contacts(
  survivor_id uuid,
  archived_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  survivor_org uuid;
  archived_org uuid;
  survivor_status text;
  archived_status text;
  caller_uid uuid := auth.uid();
BEGIN
  -- Guard 1: same-id (Pitfall 1)
  IF survivor_id = archived_id THEN
    RAISE EXCEPTION 'merge_contacts: survivor and archived must differ';
  END IF;

  -- Guard 2: load + lock both rows, check existence
  -- NOTE: Variable order MUST be (survivor_org, survivor_status) — RESEARCH.md
  -- skeleton had typo here writing into archived_status. DO NOT regress.
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

  -- Guard 3: already-archived (Pitfall 2 + Pitfall 10 chain prevention)
  IF survivor_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: survivor % is already archived', survivor_id;
  END IF;
  IF archived_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: % is already archived', archived_id;
  END IF;

  -- Guard 4: cross-org (Pitfall 3)
  IF survivor_org <> archived_org THEN
    RAISE EXCEPTION 'merge_contacts: cross-org merge not allowed (% vs %)',
      survivor_org, archived_org;
  END IF;

  -- FK rewrites (verified 8-table list against prod 2026-05-25)
  -- Direct UPDATE for tables with no composite uniqueness:
  UPDATE public.bookings         SET linked_contact_id = survivor_id WHERE linked_contact_id = archived_id;
  UPDATE public.call_logs        SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.conversations    SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.opportunities    SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.traffic_events   SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.traffic_visitors SET contact_id        = survivor_id WHERE contact_id        = archived_id;

  -- Join tables (Pitfall 4): dedupe-then-delete to avoid PK/UNIQUE violations.
  -- contact_tags columns (verified 060_tags_system.sql): (contact_id, tag_id, tagged_at, tagged_by)
  -- PK is (contact_id, tag_id). No org_id column.
  INSERT INTO public.contact_tags (contact_id, tag_id, tagged_at, tagged_by)
    SELECT survivor_id, tag_id, tagged_at, tagged_by
      FROM public.contact_tags
     WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.contact_tags WHERE contact_id = archived_id;

  -- opportunity_contacts columns (verified 1039_opportunity_contacts.sql):
  -- (id, org_id, opportunity_id, contact_id, is_primary, created_at). UNIQUE (opportunity_id, contact_id).
  INSERT INTO public.opportunity_contacts (org_id, opportunity_id, contact_id, is_primary)
    SELECT org_id, opportunity_id, survivor_id, is_primary
      FROM public.opportunity_contacts
     WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.opportunity_contacts WHERE contact_id = archived_id;

  -- Mark archived row (D-02b)
  UPDATE public.contacts
     SET identity_status        = 'archived_duplicate',
         merged_into_contact_id = survivor_id,
         updated_at             = now()
   WHERE id = archived_id;

  -- Audit log (D-02c)
  INSERT INTO public.contact_merge_log
    (org_id, survivor_id, archived_id, merged_by, merged_at, strategy)
  VALUES
    (survivor_org, survivor_id, archived_id, caller_uid, now(), 'manual');
END;
$$;

COMMENT ON FUNCTION public.merge_contacts(uuid, uuid) IS
  'Manual contact merge. Rewrites 8 FK tables, marks archived row, writes audit log. '
  'Guards: same-id, archived-target, archived-survivor, cross-org. '
  'Single implicit transaction (PL/pgSQL function body).';

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO authenticated;

-- ----- Section 5: refresh_contact_duplicate_audit() (REPLACED) ---------------
-- RESEARCH.md Pattern 5 + Pitfall 6. Two changes from migration 1056:
--   (a) Filter contacts by identity_status <> 'archived_duplicate' so archived
--       rows never re-cluster with their survivors.
--   (b) Exclude clusters whose every pairwise combination is in
--       contact_merge_exclusions.

CREATE OR REPLACE FUNCTION public.refresh_contact_duplicate_audit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  TRUNCATE public.contact_duplicate_audit;

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

COMMENT ON FUNCTION public.refresh_contact_duplicate_audit() IS
  'Rebuilds contact_duplicate_audit. Excludes archived_duplicate rows and '
  'clusters fully covered by contact_merge_exclusions. Phase 106 (replaces 1056 body).';

-- ----- Section 5a: _is_cluster_fully_excluded() helper -----------------------
-- Returns true iff every pair (a,b) with a<b drawn from contact_ids is in
-- contact_merge_exclusions. Pure helper, called from refresh function HAVING.

CREATE OR REPLACE FUNCTION public._is_cluster_fully_excluded(
  p_org_id uuid,
  p_contact_ids uuid[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH pairs AS (
    SELECT a.id AS a_id, b.id AS b_id
      FROM unnest(p_contact_ids) AS a(id)
      JOIN unnest(p_contact_ids) AS b(id) ON a.id < b.id
  ),
  total AS (SELECT count(*) AS n FROM pairs),
  excluded AS (
    SELECT count(*) AS n
      FROM pairs p
      JOIN public.contact_merge_exclusions e
        ON e.org_id        = p_org_id
       AND e.contact_id_a  = p.a_id
       AND e.contact_id_b  = p.b_id
  )
  SELECT total.n > 0 AND total.n = excluded.n FROM total, excluded;
$$;

COMMENT ON FUNCTION public._is_cluster_fully_excluded(uuid, uuid[]) IS
  'True iff every pair (a<b) from contact_ids appears in contact_merge_exclusions for org. '
  'Used by refresh_contact_duplicate_audit() to hide fully-resolved clusters.';

REVOKE ALL ON FUNCTION public._is_cluster_fully_excluded(uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public._is_cluster_fully_excluded(uuid, uuid[]) TO authenticated;

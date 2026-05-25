-- =============================================================================
-- Migration 1056: Contact Identity Audit + Generated Columns (CID-01..03)
--
-- Phase 105 of v3.0 Contact Identity workstream. Adds normalization
-- infrastructure to contacts without UNIQUE constraints (those land in
-- Phase 107 after Phase 106 merge cleanup).
--
-- Scope:
--   * normalize_phone() — IMMUTABLE SQL function mirroring TS normalisePhone
--   * contacts.phone_e164      — STORED generated column
--   * contacts.email_normalized — STORED generated column
--   * contacts.identity_status — text + CHECK, per-row backfill
--   * contact_duplicate_audit  — persistent audit table
--   * refresh_contact_duplicate_audit() — re-runnable refresh
--
-- NOT in scope: UNIQUE indexes (Phase 107), merge UI (Phase 106),
-- channel identity table (Phase 108), invariant trigger (Phase 109).
-- =============================================================================

-- ----- Section 1: normalize_phone() ------------------------------------------
-- Mirrors src/lib/contacts/zod-schemas.ts:20-28:
--   trim -> if startsWith('+') preserve plus -> strip non-digits -> if empty NULL
--   else return plus + digits.
-- IMMUTABLE so generated columns can reference it.

CREATE OR REPLACE FUNCTION public.normalize_phone(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN input IS NULL THEN NULL
    WHEN btrim(input) = '' THEN NULL
    WHEN regexp_replace(input, '[^0-9]', '', 'g') = '' THEN NULL
    ELSE
      CASE WHEN left(btrim(input), 1) = '+' THEN '+' ELSE '' END
      || regexp_replace(input, '[^0-9]', '', 'g')
  END
$$;

COMMENT ON FUNCTION public.normalize_phone(text) IS
  'Loose E.164 normalization: strip non-digits, preserve single leading +. '
  'Mirrors TS normalisePhone in src/lib/contacts/zod-schemas.ts. '
  'IMMUTABLE so it can power generated columns.';

-- ----- Section 2: phone_e164 generated column --------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_e164 text
    GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED;

COMMENT ON COLUMN public.contacts.phone_e164 IS
  'STORED generated column: normalize_phone(phone). Used by Phase 107 UNIQUE index.';

-- ----- Section 3: email_normalized generated column --------------------------
-- D-02b: inline expression, no separate function. NULLIF '' yields NULL for
-- blank emails.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_normalized text
    GENERATED ALWAYS AS (NULLIF(lower(btrim(coalesce(email, ''))), '')) STORED;

COMMENT ON COLUMN public.contacts.email_normalized IS
  'STORED generated column: lower(trim(email)) with NULL for blanks. '
  'Used by Phase 107 UNIQUE index.';

-- ----- Section 4: identity_status column -------------------------------------
-- D-03b: CHECK enumerates all 5 future values to avoid re-altering in
-- Phases 106/109/110.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'identified'
    CHECK (identity_status IN (
      'channel_only',
      'identified',
      'verified',
      'merge_conflict',
      'archived_duplicate'
    ));

COMMENT ON COLUMN public.contacts.identity_status IS
  'Identity lifecycle: channel_only (Phase 105/109), identified (default), '
  'verified (Phase 110), merge_conflict (Phase 106), archived_duplicate (Phase 106).';

-- ----- Section 5: identity_status backfill (D-03) ----------------------------

UPDATE public.contacts
   SET identity_status = 'channel_only'
 WHERE phone IS NULL
   AND email IS NULL
   AND source IN ('instagram','whatsapp','facebook','messenger')
   AND external_id IS NOT NULL;

-- ----- Section 6: contact_duplicate_audit table ------------------------------

CREATE TABLE IF NOT EXISTS public.contact_duplicate_audit (
  cluster_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  match_type       text NOT NULL CHECK (match_type IN ('phone','email')),
  normalized_value text NOT NULL,
  contact_ids      uuid[] NOT NULL,
  cluster_size     int NOT NULL CHECK (cluster_size >= 2),
  detected_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes optimized for Phase 106 query patterns:
--   * Admin merge UI lists clusters per org, sorted by size DESC
--   * Filter by match_type when picking phone vs email cluster view
CREATE INDEX IF NOT EXISTS idx_cda_org_size
  ON public.contact_duplicate_audit (org_id, cluster_size DESC);
CREATE INDEX IF NOT EXISTS idx_cda_org_match_type
  ON public.contact_duplicate_audit (org_id, match_type);

ALTER TABLE public.contact_duplicate_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_duplicate_audit_select
  ON public.contact_duplicate_audit
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- No INSERT/UPDATE/DELETE policies: only service role and SECURITY DEFINER
-- functions can mutate. refresh_contact_duplicate_audit() handles writes.

COMMENT ON TABLE public.contact_duplicate_audit IS
  'Persistent duplicate cluster audit. Populated by refresh_contact_duplicate_audit(). '
  'Read by Phase 106 admin merge UI.';

-- ----- Section 7: refresh_contact_duplicate_audit() --------------------------

CREATE OR REPLACE FUNCTION public.refresh_contact_duplicate_audit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Truncate and rebuild. Audit is a materialized snapshot; not append-only.
  TRUNCATE public.contact_duplicate_audit;

  -- Phone duplicates
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
  GROUP BY org_id, phone_e164
  HAVING count(*) >= 2;

  -- Email duplicates
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
  GROUP BY org_id, email_normalized
  HAVING count(*) >= 2;
END;
$$;

COMMENT ON FUNCTION public.refresh_contact_duplicate_audit() IS
  'Rebuilds contact_duplicate_audit from current contacts state. '
  'Re-runnable; truncate-and-insert pattern. SECURITY DEFINER bypasses RLS.';

REVOKE ALL ON FUNCTION public.refresh_contact_duplicate_audit() FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_contact_duplicate_audit() TO authenticated;

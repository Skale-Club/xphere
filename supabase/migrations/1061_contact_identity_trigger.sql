-- =============================================================================
-- Migration 1061: Contact Identity Invariant Triggers (CID-12, CID-13)
--
-- Phase 109 of v3.0 Contact Identity workstream. Enforces the rule
-- "every non-archived contact has phone OR email OR >=1 channel identity"
-- via three triggers, and auto-promotes channel_only -> identified when
-- phone or email is added.
--
-- Architecture decisions:
--   - Trigger 1 is a CONSTRAINT TRIGGER (DEFERRABLE INITIALLY DEFERRED) so
--     that future multi-statement transactions (e.g. createContact wrapped in
--     a Postgres function, tests via raw pg client) can insert contact +
--     channel identity together.
--   - The trigger SKIPS rows with identity_status='channel_only' because
--     Phase 108 webhook code uses two separate Supabase JS transactions
--     (contact INSERT then channel identity INSERT). channel_only is the
--     "promise" status; the promotion trigger transitions it to
--     'identified' which re-engages the strict check at the next UPDATE.
--   - All three triggers exempt 'archived_duplicate' (D-05).
--
-- Depends on:
--   * 1056 (identity_status, phone_e164, email_normalized generated cols)
--   * 1057 (merged_into_contact_id, archived_duplicate status)
--   * 1059 (unique constraints)
--   * 1060 (contact_channel_identities table)
--
-- Not in scope: verified state (Phase 110), source column drop (Phase 110).
-- =============================================================================

-- ----- Section 1: Pre-flight invariant check --------------------------------
-- Aborts the migration if any existing contact violates the invariant.
-- Prod baseline: 1 contact with phone+email -> no-op. Dev environments with
-- stale data must clean up via Phase 106 merge tool first.

DO $$
DECLARE violators int;
BEGIN
  SELECT count(*) INTO violators
  FROM public.contacts c
  WHERE c.phone_e164 IS NULL
    AND c.email_normalized IS NULL
    AND c.identity_status <> 'archived_duplicate'
    AND c.identity_status <> 'channel_only'
    AND NOT EXISTS (
      SELECT 1 FROM public.contact_channel_identities cci
      WHERE cci.contact_id = c.id
    );
  IF violators > 0 THEN
    RAISE EXCEPTION
      'Phase 109 pre-flight failed: % contacts violate identity invariant. Resolve via Phase 106 merge tool or add channel identities before applying migration 1061.',
      violators;
  END IF;
END $$;

-- ----- Section 2: Trigger functions ------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_contact_identity_at_commit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.identity_status = 'archived_duplicate' OR NEW.identity_status = 'channel_only' THEN
    RETURN NULL;
  END IF;

  IF NEW.phone_e164 IS NULL
     AND NEW.email_normalized IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.contact_channel_identities cci
       WHERE cci.contact_id = NEW.id
     )
  THEN
    RAISE EXCEPTION
      'contact % violates identity invariant (no phone, email, or channel identity at commit)',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_channel_identity_orphan_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_identities int;
  parent_phone text;
  parent_email text;
  parent_status text;
BEGIN
  SELECT count(*) INTO remaining_identities
  FROM public.contact_channel_identities
  WHERE contact_id = OLD.contact_id
    AND id <> OLD.id;

  IF remaining_identities = 0 THEN
    SELECT phone_e164, email_normalized, identity_status
      INTO parent_phone, parent_email, parent_status
      FROM public.contacts
      WHERE id = OLD.contact_id;

    IF NOT FOUND THEN
      RETURN OLD;
    END IF;

    IF parent_status = 'archived_duplicate' THEN
      RETURN OLD;
    END IF;

    IF parent_phone IS NULL AND parent_email IS NULL THEN
      RAISE EXCEPTION
        'cannot delete last channel identity for contact % (no phone or email to satisfy identity invariant)',
        OLD.contact_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_channel_only_on_identity_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.phone_e164 IS NOT NULL OR NEW.email_normalized IS NOT NULL THEN
    NEW.identity_status := 'identified';
  END IF;
  RETURN NEW;
END;
$$;

-- ----- Section 3: Triggers ---------------------------------------------------

-- Trigger 1: CONSTRAINT TRIGGER - deferred to COMMIT.
-- Fires AFTER INSERT OR UPDATE on contacts.
-- NOTE: CREATE CONSTRAINT TRIGGER cannot use UPDATE OF column-list; the
-- function body is cheap so we accept all UPDATEs.
CREATE CONSTRAINT TRIGGER enforce_contact_identity_at_commit
  AFTER INSERT OR UPDATE ON public.contacts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_contact_identity_at_commit_fn();

-- Trigger 2: BEFORE DELETE on contact_channel_identities - not deferrable.
CREATE TRIGGER prevent_channel_identity_orphan
  BEFORE DELETE ON public.contact_channel_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_channel_identity_orphan_fn();

-- Trigger 3: BEFORE UPDATE on contacts when promoting from channel_only.
CREATE TRIGGER promote_channel_only_on_identity
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  WHEN (OLD.identity_status = 'channel_only')
  EXECUTE FUNCTION public.promote_channel_only_on_identity_fn();

-- ----- Section 4: Documentation ----------------------------------------------

COMMENT ON FUNCTION public.enforce_contact_identity_at_commit_fn() IS
  'Phase 109 (CID-12). Enforces "non-archived contact has phone OR email OR >=1 channel identity". '
  'Skips archived_duplicate (D-05) and channel_only (Option A: webhooks use two-transaction insert).';

COMMENT ON FUNCTION public.prevent_channel_identity_orphan_fn() IS
  'Phase 109 (CID-12). Blocks DELETE of the last channel identity of a phone/email-less, non-archived contact.';

COMMENT ON FUNCTION public.promote_channel_only_on_identity_fn() IS
  'Phase 109 (CID-13). Auto-promotes identity_status channel_only -> identified when phone or email is added.';

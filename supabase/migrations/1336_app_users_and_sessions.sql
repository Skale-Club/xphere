-- Identity Platform migration: the application owns users and sessions.
-- Design: docs/auth/identity-platform-migration.md
--
-- Additive and idempotent. auth.users keeps its rows (only NULL token columns are
-- repaired, section 7) so a rollback only needs the old code. User ids are copied, so no RLS policy and no data row
-- changes owner.

-- 1) public.users ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text,
  phone            text,
  user_metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sign_in_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Emails are stored lowercase, so a plain lower() index also stops case variants
-- from slipping in later. Checked against auth.users before writing this: no
-- two rows collide on lower(trim(email)), so the backfill below cannot violate it.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON public.users (lower(email)) WHERE email IS NOT NULL;
-- Phone is the sign-in identity (E.164). NULL is allowed: Google-only accounts
-- get theirs through scripts/link-user-phone.ts.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key
  ON public.users (phone) WHERE phone IS NOT NULL;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

-- Only the service role writes; the browser never gets to edit identity.
REVOKE ALL ON public.users FROM anon, authenticated;
GRANT SELECT ON public.users TO authenticated;

-- 2) Backfill from auth.users ------------------------------------------------

INSERT INTO public.users (id, email, phone, user_metadata, last_sign_in_at, created_at)
SELECT
  id,
  lower(trim(email)),
  CASE
    WHEN NULLIF(trim(phone), '') IS NULL THEN NULL
    WHEN trim(phone) LIKE '+%' THEN trim(phone)
    ELSE '+' || trim(phone)
  END,
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  last_sign_in_at,
  created_at
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 3) Google identity links ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auth_google_identities (
  project_id  text NOT NULL,
  subject     text NOT NULL,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, subject)
);
CREATE INDEX IF NOT EXISTS auth_google_identities_user
  ON public.auth_google_identities (user_id);

-- RLS on with no policy: only the service role (which bypasses RLS) can touch it.
ALTER TABLE public.auth_google_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_google_identities FROM anon, authenticated;

-- 4) Sessions ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  ip           text
);
CREATE INDEX IF NOT EXISTS app_sessions_user ON public.app_sessions (user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expires ON public.app_sessions (expires_at);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_sessions FROM anon, authenticated;

-- 5) Repoint every foreign key at auth.users to public.users -----------------
--
-- pg_get_constraintdef() renders the whole definition, ON DELETE / ON UPDATE
-- rules included, so swapping the referenced table keeps each rule as it was.
-- DROP and ADD run in one ALTER TABLE statement per constraint, so there is no
-- window where the table has no constraint. Re-running is a no-op: after the
-- first run no constraint outside the auth schema references auth.users, so the
-- loop selects nothing.
DO $$
DECLARE
  fk record;
  new_def text;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl,
           c.conname,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND c.connamespace <> 'auth'::regnamespace
  LOOP
    new_def := replace(fk.def, 'auth.users(', 'public.users(');
    IF new_def = fk.def THEN
      RAISE EXCEPTION 'Could not repoint % on %: unexpected definition %', fk.conname, fk.tbl, fk.def;
    END IF;
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s',
      fk.tbl, fk.conname, fk.conname, new_def
    );
  END LOOP;
END
$$;

-- 6) get_org_member_profiles reads public.users ------------------------------
-- Same signature and semantics as migration 1295; only the source table moves.
-- It was the one function that read auth.users (no policy or view does).

CREATE OR REPLACE FUNCTION public.get_org_member_profiles(
  p_org_id   uuid,
  p_page     integer DEFAULT 1,
  p_per_page integer DEFAULT 20
)
RETURNS TABLE(
  id           uuid,
  user_id      uuid,
  role         text,
  joined_at    timestamptz,
  email        text,
  phone        text,
  full_name    text,
  avatar_url   text,
  total_count  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    om.id,
    om.user_id,
    om.role::text,
    om.created_at                                             AS joined_at,
    u.email,
    NULLIF(TRIM(COALESCE(
      u.user_metadata->>'phone',
      u.phone
    )), '')                                                   AS phone,
    COALESCE(
      u.user_metadata->>'full_name',
      u.user_metadata->>'name'
    )::text                                                   AS full_name,
    NULLIF(TRIM(u.user_metadata->>'avatar_url'), '')          AS avatar_url,
    COUNT(*) OVER()                                           AS total_count
  FROM public.org_members om
  JOIN public.users u ON u.id = om.user_id
  WHERE om.organization_id = p_org_id
    -- The caller must belong to the organization being read. Without this the
    -- SECURITY DEFINER context happily enumerates any org's members.
    AND EXISTS (
      SELECT 1
      FROM public.org_members caller
      WHERE caller.organization_id = p_org_id
        AND caller.user_id = (SELECT auth.uid())
    )
  ORDER BY om.created_at ASC
  LIMIT  p_per_page
  OFFSET (p_page - 1) * p_per_page;
$$;

REVOKE EXECUTE ON FUNCTION public.get_org_member_profiles(uuid, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_org_member_profiles(uuid, integer, integer) TO authenticated;

-- 7) Repair NULL token columns in auth.users ----------------------------------
-- The database token bridge asks GoTrue for tokens (src/lib/auth/supabase-jwt.ts).
-- GoTrue scans these columns into non-nullable strings and fails with "Database
-- error finding user" when any is NULL; rows created outside GoTrue (the demo
-- user) have them NULL. Empty string is what GoTrue itself writes.

UPDATE auth.users
SET confirmation_token         = COALESCE(confirmation_token, ''),
    recovery_token             = COALESCE(recovery_token, ''),
    email_change               = COALESCE(email_change, ''),
    email_change_token_new     = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    phone_change               = COALESCE(phone_change, ''),
    phone_change_token         = COALESCE(phone_change_token, ''),
    reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;

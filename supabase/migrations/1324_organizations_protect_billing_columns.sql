-- =============================================================================
-- Migration 1324: members can no longer grant themselves a plan
-- =============================================================================
-- The org_update RLS policy only checks that the row is the caller's current
-- org, and authenticated holds table-wide UPDATE. So any member could call
-- PostgREST directly with
--
--   PATCH /rest/v1/organizations?id=eq.<org>  {"plan_override":"agency"}
--
-- and get any plan for free, or push trial_ends_at out forever. Both columns
-- belong to the platform admin: they are written only by the admin actions in
-- src/app/(admin)/admin/_actions/billing-actions.ts, through the service role.
--
-- A column-level REVOKE does not work while the table-level UPDATE grant
-- exists, and swapping that grant for a column list would silently make every
-- future column read-only for members. A trigger keeps the rest of the row
-- exactly as writable as before:
--
--   UPDATE by anon/authenticated that changes plan_override or trial_ends_at
--          -> error 42501.
--   INSERT by anon/authenticated -> plan_override forced to NULL and
--          trial_ends_at to the normal 14-day default (the app never sets them
--          on insert).
--
-- service_role, postgres and SECURITY DEFINER functions are unaffected:
-- current_user is their owner, not anon/authenticated.
--
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.organizations_protect_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.plan_override := NULL;
    NEW.trial_ends_at := now() + interval '14 days';
    RETURN NEW;
  END IF;

  IF NEW.plan_override IS DISTINCT FROM OLD.plan_override
     OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN
    RAISE EXCEPTION 'plan_override and trial_ends_at can only be changed by the platform admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_protect_billing_columns ON public.organizations;
CREATE TRIGGER trg_organizations_protect_billing_columns
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_protect_billing_columns();

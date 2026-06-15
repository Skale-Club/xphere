-- Migration 1207: Billing trial window + agency plan override on organizations
--
-- Part of the complete billing system (entitlements foundation). Adds two columns
-- to organizations:
--   trial_ends_at  — when the org's free trial expires. DEFAULT now()+14d so every
--                    NEW org created after this migration gets a trial automatically,
--                    regardless of where the org row is created (signup trigger/RPC).
--   plan_override  — a plan key the platform admin (agency) can assign to bypass
--                    Stripe and grant a plan manually (hybrid sales model). NULL =
--                    no override; the effective plan then derives from the Stripe
--                    subscription or the trial.
--
-- No enforcement here — this is the data foundation only. Enforcement lands later,
-- behind a flag (see plan Phase 3/7).
--
-- IMPORTANT — grandfathering: `ADD COLUMN ... DEFAULT` also backfills EXISTING rows,
-- which would give every current org a 14-day trial that expires soon. To avoid
-- locking active customers out the moment enforcement turns on, we extend every
-- org that exists at migration time to a far-future trial. New orgs (created after
-- this runs) still get the normal 14-day default. Migrations run exactly once, so
-- the unconditional UPDATE is safe.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  ADD COLUMN IF NOT EXISTS plan_override text;

COMMENT ON COLUMN public.organizations.trial_ends_at IS
  'When the free trial expires. New orgs default to now()+14d. Effective access also considers subscription and plan_override.';
COMMENT ON COLUMN public.organizations.plan_override IS
  'Plan key manually assigned by the platform admin (agency), bypassing Stripe. NULL = derive plan from subscription/trial.';

-- Grandfather all orgs that exist right now (see note above).
UPDATE public.organizations
  SET trial_ends_at = now() + interval '3650 days';

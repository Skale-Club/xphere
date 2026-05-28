-- 1105_org_company_profile.sql
-- Turn the workspace into a real company control panel: legal identity, tax id,
-- structured postal address, country, timezone, and default currency.
--
-- `default_currency` was referenced in src/types/database.ts and app code but
-- never had a migration (schema drift) — this closes that gap idempotently.
-- Address is structured (not free text) so it can be formatted into email
-- footers (CAN-SPAM) and reused elsewhere. Timezone is the org-level source of
-- truth for date display (the per-user scheduling_profiles.timezone stays
-- separate — that's host availability, not display).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_currency      text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS legal_name            text,
  ADD COLUMN IF NOT EXISTS tax_id                text,
  ADD COLUMN IF NOT EXISTS address_line1         text,
  ADD COLUMN IF NOT EXISTS address_line2         text,
  ADD COLUMN IF NOT EXISTS address_city          text,
  ADD COLUMN IF NOT EXISTS address_state         text,
  ADD COLUMN IF NOT EXISTS address_postal_code   text,
  ADD COLUMN IF NOT EXISTS address_country       text,
  ADD COLUMN IF NOT EXISTS timezone              text NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN public.organizations.timezone IS
  'IANA timezone (e.g. America/Sao_Paulo). Org-level source of truth for date display.';
COMMENT ON COLUMN public.organizations.address_country IS 'ISO-3166-1 alpha-2 country code.';

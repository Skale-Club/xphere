-- =============================================================================
-- Migration 1213: Xtimator CRM Mirror
--
-- Adds the provenance + idempotency columns needed to mirror Xtimator users into
-- this org's CRM as an Account (the business) + Contact (the owner) + Opportunity
-- (the subscription lifecycle deal) — so each Xtimator customer surfaces in the
-- pipeline, the contact list and the contact timeline.
--
--   external_source / external_id  — provenance + idempotency key for the mirror
--   external_updated_at            — source event time, for last-write-wins ordering
--
-- The receiver (/api/xtimator/webhook) upserts by (org_id, external_source,
-- external_id) and applies last-write-wins via external_updated_at vs the
-- incoming event's occurred_at. Mirrors the Xkedule booking-mirror pattern
-- (migration 1212).
--
-- contacts.external_id (051) and accounts.external_id (064) already exist; only
-- external_source + external_updated_at are added there. opportunities gets the
-- full trio. All columns are nullable and additive — native rows
-- (external_source IS NULL) are unaffected.
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS external_source     text,
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS external_source     text,
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz;

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS external_source     text,
  ADD COLUMN IF NOT EXISTS external_id         text,
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz;

-- ----- Idempotency: one mirror row per (org, source, external id) -------------
-- Partial indexes scope only to mirror rows; legacy contacts that carry a bare
-- external_id with no external_source (e.g. channel migrations) are excluded.

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_external_unique
  ON public.contacts (org_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_external_unique
  ON public.accounts (org_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_external_unique
  ON public.opportunities (org_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

-- ----- Fast lookup of mirror rows (webhook upserts, reconciliation) -----------

CREATE INDEX IF NOT EXISTS idx_contacts_external_source
  ON public.contacts (org_id, external_source)
  WHERE external_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_external_source
  ON public.accounts (org_id, external_source)
  WHERE external_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_external_source
  ON public.opportunities (org_id, external_source)
  WHERE external_source IS NOT NULL;

-- =============================================================================
-- Footer
--   {contacts,accounts,opportunities}.external_source = 'xtimator' marks a row
--   owned by the Xtimator integration. external_id = the Xtimator company UUID.
-- =============================================================================

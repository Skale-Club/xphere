-- =============================================================================
-- Migration 1241: Index contact_channel_identities.provider (SEED-048 Phase E)
--
-- identityContactIds() in src/app/(dashboard)/contacts/actions.ts filters this
-- table by `provider` (IN-list and equality) with no supporting index — only
-- idx_cci_contact_id (contact_id) exists today. Composite (provider, contact_id)
-- covers both the filter and the immediate SELECT contact_id projection.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_contact_channel_identities_provider
  ON public.contact_channel_identities (provider, contact_id);

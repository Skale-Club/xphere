-- =============================================================================
-- Migration 1101: defense-in-depth CHECK constraint for contacts.email format
--
-- Application-layer validation already exists (normaliseEmail in
-- src/lib/contacts/zod-schemas.ts), but historically several entry points
-- (updateContactField, GHL webhook, CSV import) silently accepted garbage
-- like "skale.clubgmail.com" (missing @). This constraint catches anything
-- that slips past the app layer.
--
-- NOT VALID = don't check existing rows. Legacy malformed emails stay in
-- place (UI flags them with an amber warning icon) so operators can fix
-- them manually. Only new INSERTs and UPDATEs are validated.
-- =============================================================================

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_email_format;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_email_format
  CHECK (
    email IS NULL
    OR email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
  NOT VALID;

-- Migration 1085: Contact DND (Do Not Disturb) fields
-- Adds DND (communication blocking) fields to the contacts table.
-- dnd_channels: array of blocked channels e.g. ['sms', 'email', 'calls', 'whatsapp', 'all']
-- dnd_enabled: quick top-level flag (true when dnd_channels is non-empty)

BEGIN;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS dnd_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dnd_channels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dnd_note text,
  ADD COLUMN IF NOT EXISTS dnd_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS dnd_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index to quickly find DND-blocked contacts across the org
CREATE INDEX IF NOT EXISTS idx_contacts_dnd_enabled
  ON public.contacts (org_id, dnd_enabled)
  WHERE dnd_enabled = true;

COMMENT ON COLUMN public.contacts.dnd_enabled IS 'True when any communication channel is blocked for this contact.';
COMMENT ON COLUMN public.contacts.dnd_channels IS 'Array of blocked channel keys. Supported values: sms, email, calls, whatsapp, all. ''all'' blocks every channel.';
COMMENT ON COLUMN public.contacts.dnd_note IS 'Optional admin note explaining why DND was set.';
COMMENT ON COLUMN public.contacts.dnd_set_at IS 'Timestamp when DND was last enabled or modified.';
COMMENT ON COLUMN public.contacts.dnd_set_by IS 'User who last set the DND status.';

COMMIT;

-- Phone Numbers — Per-Number Settings Architecture (Phase 1: Schema)
--
-- Extends twilio_phone_numbers (migration 058) with per-number operational
-- configuration so each phone number becomes a first-class resource that can
-- own a Vapi assistant mapping, a responsible person, a business purpose,
-- chat/inbox routing, and workflow trigger behavior.
--
-- Storage decision: extend the existing table instead of creating a
-- complementary 1:1 table. Vapi mapping decision: store the assistant id
-- directly on the phone number with a fallback to the org-level
-- assistant_mappings row at runtime.
--
-- This migration only adds nullable columns and a non-unique index. It does
-- not change RLS, does not backfill values, and does not break existing
-- inbound or outbound routing.

BEGIN;

ALTER TABLE public.twilio_phone_numbers
  ADD COLUMN IF NOT EXISTS vapi_assistant_id   TEXT,
  ADD COLUMN IF NOT EXISTS responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_purpose    TEXT,
  ADD COLUMN IF NOT EXISTS inbox_label         TEXT,
  ADD COLUMN IF NOT EXISTS chat_routing        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ;

-- Supports per-number Vapi assistant resolution during inbound call routing.
CREATE INDEX IF NOT EXISTS idx_twilio_phone_numbers_vapi_assistant
  ON public.twilio_phone_numbers (vapi_assistant_id)
  WHERE vapi_assistant_id IS NOT NULL;

-- Supports "phone numbers I'm responsible for" lookups in the dashboard.
CREATE INDEX IF NOT EXISTS idx_twilio_phone_numbers_responsible_user
  ON public.twilio_phone_numbers (responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;

COMMIT;

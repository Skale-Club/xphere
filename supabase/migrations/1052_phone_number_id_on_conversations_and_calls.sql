-- Phone Numbers — Per-Number Settings Architecture (Phase 2: Runtime — inbound)
--
-- Link conversations and call_logs to the originating twilio_phone_numbers row
-- so inbox views, reporting, and per-number workflow triggers can use the
-- number context that is already resolved during inbound routing.
--
-- Nullable on both tables: existing rows stay valid, ON DELETE SET NULL keeps
-- the historical record even if the operator later deletes a phone-number
-- configuration.

BEGIN;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS phone_number_id UUID
  REFERENCES public.twilio_phone_numbers(id) ON DELETE SET NULL;

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS phone_number_id UUID
  REFERENCES public.twilio_phone_numbers(id) ON DELETE SET NULL;

-- Inbox filter "show conversations for this number" + reporting joins.
CREATE INDEX IF NOT EXISTS idx_conversations_phone_number
  ON public.conversations (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_phone_number
  ON public.call_logs (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

COMMIT;

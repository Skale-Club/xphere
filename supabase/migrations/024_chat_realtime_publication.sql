-- Migration 024: Enable Realtime for chat inbox
-- Adds conversations and conversation_messages to the supabase_realtime publication
-- so the admin inbox can subscribe via postgres_changes (replacing 30s/15s polling).
-- Idempotent: wraps each ALTER in a DO block that swallows duplicate_object errors.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Migration 1206: Enable Realtime for the outbound call panel
-- Adds call_logs to the supabase_realtime publication so the dialer can subscribe
-- via postgres_changes and reflect live call lifecycle (ringing → connected →
-- ended/busy/no-answer) for phone_forward / sip calls, where the browser is not
-- part of the call and status only arrives via Twilio webhooks.
-- Idempotent: wraps the ALTER in a DO block that swallows duplicate_object errors.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

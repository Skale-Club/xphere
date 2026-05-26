-- Migration 1077: Add email fields to conversation_messages table
-- Nullable columns for email-channel messages (subject, from/to/cc, Resend message ID, delivery status)

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_from text,
  ADD COLUMN IF NOT EXISTS email_to text,
  ADD COLUMN IF NOT EXISTS email_cc text,
  ADD COLUMN IF NOT EXISTS email_message_id text,   -- Resend's returned message ID
  ADD COLUMN IF NOT EXISTS email_delivery_status text; -- delivered | bounced | complained | failed

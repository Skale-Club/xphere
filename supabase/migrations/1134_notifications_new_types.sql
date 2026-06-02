-- Migration 1134: Extend notifications.type CHECK to include new_message and incoming_call

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('new_conversation', 'missed_call', 'flow_failed', 'new_message', 'incoming_call'));

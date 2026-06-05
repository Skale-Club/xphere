-- =============================================================================
-- Migration 1148: Widget greeting composer settings.
-- Adds the minimized inline "Write a message…" greeting composer config:
--   - widget_greeting_enabled        — show the greeting composer after a delay
--   - widget_greeting_message        — text shown in the greeting bubble (falls
--                                       back to widget_welcome_message when null)
--   - widget_greeting_delay_seconds  — seconds before the composer slides in
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS widget_greeting_enabled        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS widget_greeting_message        text,
  ADD COLUMN IF NOT EXISTS widget_greeting_delay_seconds  integer NOT NULL DEFAULT 3;

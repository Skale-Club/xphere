-- Migration 1304: let an agent read and write the platform's OWN calendar.
--
-- Until now the only way an assistant could see a free slot or book anything
-- was through an external provider: the Xkedule actions, or the legacy
-- GoHighLevel pair. An org running Xphere's own calendar — the one behind
-- /book/<profile>/<event-type>, with its event types, weekly availability and
-- Google conflict sync — had no way to let an agent near it. Its robot could
-- describe the booking page and read the URL out loud, and that was all.
--
-- Two values, mirroring that asymmetry:
--
--   calendar_list_slots   read  — free times for an event type on a date
--   calendar_book_meeting write — books one, behind the same spoken-consent
--                                 gate the Xkedule booking writes carry
--
-- Additive: no column, no backfill, no behaviour change for anyone until an
-- org grants one of these to an agent.
--
-- PostgreSQL requires ALTER TYPE ... ADD VALUE to run outside a transaction
-- block; both statements are idempotent, so a re-run is a no-op.

ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'calendar_list_slots';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'calendar_book_meeting';

-- =============================================================================
-- Migration 1252: Calendar tick watermark (SCH-01, SCH-02, SCH-03)
-- =============================================================================
-- Durable scan-progress cursor for the calendar-tick scheduler
-- (src/app/api/cron/calendar-tick/route.ts, wired in Plan 128-05). Replaces
-- the old fixed [now, now+1min) window anchored to wall-clock time with a
-- (watermark, now] window, so a delayed or skipped GitHub Actions run still
-- catches up on everything that became due in the gap (SCH-01). This table
-- itself IS the "durable scheduling progress" SCH-03 requires.
--
-- One row per scanned event_type ('meeting.starts_in' | 'meeting.ended').
-- scanned_to advances to `now` only after a tick's scan pass for that event
-- type completes with zero released (retried) dispatches — see
-- src/lib/calendar/tick.ts's shouldAdvanceWatermark. A pass with any
-- released dispatch leaves the watermark unchanged, so the FULL window is
-- retried next tick; already-succeeded items are cheap no-ops via
-- scheduled_workflow_ticks' composite primary key (migration 087).
--
-- Idempotent: safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.calendar_tick_watermark (
  event_type  text        PRIMARY KEY,
  scanned_to  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_calendar_tick_watermark_updated_at ON public.calendar_tick_watermark;
CREATE TRIGGER trg_calendar_tick_watermark_updated_at
  BEFORE UPDATE ON public.calendar_tick_watermark
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Single-tenant (no org_id — this is platform infrastructure, not tenant
-- data). RLS enabled with NO policy locks the table to service-role server
-- code only, matching automation_schedules (migration 033).
ALTER TABLE public.calendar_tick_watermark ENABLE ROW LEVEL SECURITY;

-- Baseline both known event types at now() so the first tick after this
-- migration lands has a defined starting point ("nothing to catch up on
-- yet") instead of NULL, which would otherwise force route.ts to
-- special-case a never-seen row. This intentionally does NOT retroactively
-- backfill any pre-migration overdue reminders.
INSERT INTO public.calendar_tick_watermark (event_type, scanned_to)
VALUES ('meeting.starts_in', now()), ('meeting.ended', now())
ON CONFLICT (event_type) DO NOTHING;

-- Documents the SCH-02 semantic change to an existing column (no schema
-- change to migration 087's table — only what the app writes into
-- fired_minute changes, in Plan 128-05).
COMMENT ON COLUMN public.scheduled_workflow_ticks.fired_minute IS
  'SCH-02: the offset-derived due-moment (booking.start_at + offset, or booking.end_at, truncated to the minute) — NOT wall-clock tick time. Must be stable across retries/catch-up so the composite primary key on this table is a true exactly-once guarantee. See src/lib/calendar/tick.ts computeStartsInTargetMinute / computeEndedTargetMinute.';

COMMENT ON TABLE public.calendar_tick_watermark IS
  'SCH-01/SCH-03: durable scan-progress cursor for calendar-tick. One row per event_type; scanned_to advances after each tick pass that completed with zero released dispatches.';

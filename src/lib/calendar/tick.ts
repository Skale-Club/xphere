// Pure, DB-agnostic scheduling math for the calendar-tick scheduler
// (src/app/api/cron/calendar-tick/route.ts, wired in Plan 128-05).
//
// Deliberately has no Supabase import so it stays unit-testable without
// mocking the database — matches the established pattern of
// src/lib/obs/alerts.ts (tested via tests/obs-alerts.test.ts).
//
// This module fixes two related scheduling bugs:
//
//   SCH-01 (delay-tolerant window): the route previously anchored its scan
//   window to a fixed one-minute slice of wall-clock "now" instead of a
//   durable watermark, so a delayed or skipped cron tick permanently lost
//   any booking whose due-moment fell in the gap. computeDueWindow/isDue
//   replace that with a watermark-bounded, capped scan window.
//
//   SCH-02 (stable, offset-derived dedup key): the route previously derived
//   its idempotency key (`fired_minute`) from the tick's wall-clock time,
//   which breaks once the scan window can span multiple minutes during
//   catch-up — every booking caught in one pass would collapse onto the
//   same key. computeStartsInTargetMinute/computeEndedTargetMinute instead
//   derive the key from the booking's own start_at/end_at + offset (the
//   due-moment itself), so the same logical due-moment always produces the
//   same key regardless of when the tick that discovers it actually runs.

/**
 * Hard cap on catch-up lookback (minutes). Orchestrator decision (128-CONTEXT
 * open question 1): 24h. Protects against firing stale "starts in N minutes"
 * content after a long outage; meeting.ended has no equivalent staleness
 * problem and is not capped differently — only the SCAN window is capped,
 * uniformly, for both event types.
 */
export const MAX_CATCHUP_LOOKBACK_MINUTES = 24 * 60

export interface DueWindow {
  /** Exclusive lower bound — the persisted watermark, capped. */
  scanStart: Date
  /** Inclusive upper bound — the tick's current wall-clock time. */
  scanEnd: Date
}

export function truncateToMinute(date: Date): Date {
  const copy = new Date(date.getTime())
  copy.setSeconds(0, 0)
  return copy
}

export function computeDueWindow(
  now: Date,
  watermark: Date | null,
  maxLookbackMinutes: number = MAX_CATCHUP_LOOKBACK_MINUTES,
): DueWindow {
  const cappedFloor = new Date(now.getTime() - maxLookbackMinutes * 60_000)
  const scanStart =
    watermark && watermark.getTime() > cappedFloor.getTime() ? watermark : cappedFloor
  return { scanStart, scanEnd: now }
}

export function isDue(targetMinute: Date, window: DueWindow): boolean {
  return (
    targetMinute.getTime() > window.scanStart.getTime() &&
    targetMinute.getTime() <= window.scanEnd.getTime()
  )
}

export function computeStartsInTargetMinute(startAt: Date, offsetMinutes: number): Date {
  // offset is negative for "before", matching the sign convention already
  // used in route.ts's parseOffset/fire-moment math (fireTargetStart =
  // now - offsetMs, i.e. adding a negative offset moves the fire moment
  // earlier).
  return truncateToMinute(new Date(startAt.getTime() + offsetMinutes * 60_000))
}

export function computeEndedTargetMinute(endAt: Date): Date {
  return truncateToMinute(endAt)
}

export function isStartsInCandidateStale(startAt: Date, now: Date): boolean {
  return startAt.getTime() <= now.getTime()
}

export function shouldAdvanceWatermark(releasedCount: number): boolean {
  return releasedCount === 0
}

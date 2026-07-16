// SEED-027 Phase C: time-based workflow tick scheduler.
//
// Invoked by the GitHub Actions workflow `.github/workflows/calendar-tick.yml`
// (Vercel Hobby crons are capped at daily; GitHub Actions runs every 5 min).
// For each tick window:
//   1. Query active workflows with trigger_type='event' and event in
//      ('meeting.starts_in', 'meeting.ended')
//   2. For each, find bookings whose target moment falls in [now, now + 1min)
//   3. Enqueue exactly once per (workflow, booking, event, fired_minute)
//      using scheduled_workflow_ticks idempotency table | duplicates are
//      safely dropped at the DB level
//   4. Dispatch via lib/calendar/transition.emitCalendarEvent
//
// The caller sends CRON_SECRET as Authorization: Bearer header | required
// to prevent unauthorized invocations.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { emitCalendarEvent } from '@/lib/calendar/transition'
import {
  emitOpportunityEvent,
  type OpportunityEventType,
} from '@/lib/pipeline/events'
import { resumeRun } from '@/lib/flows/engine'
import { findExpiredWaits, satisfyWait } from '@/lib/flows/wait'
import { captureApiError } from '@/lib/api-error'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET

function parseOffset(offset: string): number | null {
  // Supports "-5m", "-1h", "-24h", "-2d", and positive variants.
  const match = /^(-?\d+)([smhd])$/.exec(offset)
  if (!match) return null
  const value = parseInt(match[1], 10)
  switch (match[2]) {
    case 's':
      return Math.round(value / 60)
    case 'm':
      return value
    case 'h':
      return value * 60
    case 'd':
      return value * 60 * 24
    default:
      return null
  }
}

interface WorkflowTickRow {
  id: string
  org_id: string
  trigger_config: Record<string, unknown>
}

export async function GET(request: Request) {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  // Truncate to the current minute (idempotency keys are per-minute).
  const now = new Date()
  now.setSeconds(0, 0)
  const windowStart = now.toISOString()
  const windowEnd = new Date(now.getTime() + 60_000).toISOString()

  // ─── meeting.starts_in: find active workflows with this event ─────────────
  const { data: startsInWorkflows, error: wfErr } = await supabase
    .from('workflows')
    .select('id, org_id, trigger_config')
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event: 'meeting.starts_in' })

  if (wfErr) {
    return Response.json({ ok: false, error: wfErr.message }, { status: 500 })
  }

  let totalDispatched = 0
  let totalSkipped = 0

  for (const wf of (startsInWorkflows ?? []) as WorkflowTickRow[]) {
    const offsetStr = (wf.trigger_config?.offset as string | undefined) ?? '-5m'
    const offsetMinutes = parseOffset(offsetStr)
    if (offsetMinutes == null) continue

    // Bookings whose (start_at + offset) falls in this minute window.
    // offset is negative for "before"; we add it to start_at to get the
    // fire moment. Example: start_at=14:00, offset=-5m → fire at 13:55.
    const offsetMs = offsetMinutes * 60_000
    const fireTargetStart = new Date(now.getTime() - offsetMs).toISOString()
    const fireTargetEnd = new Date(now.getTime() - offsetMs + 60_000).toISOString()

    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, org_id, status')
      .eq('org_id', wf.org_id)
      .eq('status', 'confirmed')
      .gte('start_at', fireTargetStart)
      .lt('start_at', fireTargetEnd)

    for (const booking of bookings ?? []) {
      // Idempotency: try inserting the tick row; PK collision = already dispatched.
      const { error: insErr } = await supabase
        .from('scheduled_workflow_ticks')
        .insert({
          workflow_id: wf.id,
          booking_id: booking.id as string,
          event_type: 'meeting.starts_in',
          fired_minute: windowStart,
        })

      if (insErr) {
        totalSkipped++
        continue
      }

      try {
        await emitCalendarEvent(
          { supabase, depth: 0 },
          {
            event: 'meeting.starts_in',
            booking_id: booking.id as string,
            org_id: booking.org_id as string,
            offset_minutes: offsetMinutes,
          },
        )
        totalDispatched++
      } catch (emitErr) {
        // Release the idempotency claim so the next tick retries.
        console.error('[calendar-tick] starts_in emit failed, releasing tick:', emitErr)
        await supabase
          .from('scheduled_workflow_ticks')
          .delete()
          .eq('workflow_id', wf.id)
          .eq('booking_id', booking.id as string)
          .eq('event_type', 'meeting.starts_in')
          .eq('fired_minute', windowStart)
        totalSkipped++
      }
    }
  }

  // ─── meeting.ended: bookings where end_at just passed ─────────────────────
  const { data: endedWorkflows } = await supabase
    .from('workflows')
    .select('id, org_id, trigger_config')
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event: 'meeting.ended' })

  for (const wf of (endedWorkflows ?? []) as WorkflowTickRow[]) {
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, org_id')
      .eq('org_id', wf.org_id)
      .in('status', ['confirmed', 'showed'])
      .gte('end_at', windowStart)
      .lt('end_at', windowEnd)

    for (const booking of bookings ?? []) {
      const { error: insErr } = await supabase
        .from('scheduled_workflow_ticks')
        .insert({
          workflow_id: wf.id,
          booking_id: booking.id as string,
          event_type: 'meeting.ended',
          fired_minute: windowStart,
        })

      if (insErr) {
        totalSkipped++
        continue
      }

      try {
        await emitCalendarEvent(
          { supabase, depth: 0 },
          {
            event: 'meeting.ended',
            booking_id: booking.id as string,
            org_id: booking.org_id as string,
          },
        )
        totalDispatched++
      } catch (emitErr) {
        console.error('[calendar-tick] ended emit failed, releasing tick:', emitErr)
        await supabase
          .from('scheduled_workflow_ticks')
          .delete()
          .eq('workflow_id', wf.id)
          .eq('booking_id', booking.id as string)
          .eq('event_type', 'meeting.ended')
          .eq('fired_minute', windowStart)
        totalSkipped++
      }
    }
  }

  // ─── Pipeline time-based events (SEED-036) ────────────────────────────────
  // For each active workflow whose trigger is one of the time-based opportunity
  // events, scan the matching opportunities and emit when the condition is true
  // at the current minute. Idempotency is enforced by scheduled_opportunity_ticks:
  // a given (workflow, opportunity, event_type) only fires once per day.
  const { dispatched: pipelineDispatched, skipped: pipelineSkipped } =
    await processOpportunityTimeBasedEvents(supabase, now)
  totalDispatched += pipelineDispatched
  totalSkipped += pipelineSkipped

  // ─── Wait-node timeouts: resume runs whose wait deadline passed ───────────
  // Covers both sleep (timeout = the sleep duration) and wait_for_event that
  // expired without the event arriving (resumes with state.wait.timed_out=true).
  let timedOutWaits = 0
  const expired = await findExpiredWaits(supabase, windowStart)
  for (const w of expired) {
    // Only resume if we win the atomic claim — an event arriving in the same
    // minute may already be resuming this run (see resume-waits.ts).
    const claimed = await satisfyWait(supabase, w.id, { timedOut: true })
    if (!claimed) continue
    try {
      await resumeRun(supabase, { runId: w.run_id, nodeId: w.node_id, timedOut: true })
      timedOutWaits++
    } catch (err) {
      console.error('[calendar-tick] resume on timeout failed:', err)
      captureApiError(err)
    }
  }

  return Response.json({
    ok: true,
    window_start: windowStart,
    dispatched: totalDispatched,
    skipped_already_dispatched: totalSkipped,
    wait_timeouts_resumed: timedOutWaits,
  })
}

// ─── Opportunity time-based event scanner ─────────────────────────────────────

const OPPORTUNITY_TIME_BASED_EVENTS: readonly OpportunityEventType[] = [
  'opportunity.aged_in_stage',
  'opportunity.no_activity',
  'opportunity.close_date_approaching',
  'opportunity.close_date_passed',
  'opportunity.stale',
]

// Re-fire guard: a unique (workflow, opportunity, event, UTC-day) index on
// scheduled_opportunity_ticks (migration 1245) enforces at-most-once per day.
// The cron runs every 5 minutes so without this a daily condition would fire
// ~288 times.

interface OpportunityWorkflowRow {
  id: string
  org_id: string
  trigger_config: Record<string, unknown> | null
}

interface OpportunityRow {
  id: string
  org_id: string
  stage_id: string
  status: 'open' | 'won' | 'lost'
  expected_close_date: string | null
  updated_at: string
  created_at: string
}

async function processOpportunityTimeBasedEvents(
  supabase: ReturnType<typeof createClient<Database>>,
  now: Date,
): Promise<{ dispatched: number; skipped: number }> {
  let dispatched = 0
  let skipped = 0

  for (const eventType of OPPORTUNITY_TIME_BASED_EVENTS) {
    const { data: wfs, error: wfErr } = await supabase
      .from('workflows')
      .select('id, org_id, trigger_config')
      .eq('trigger_type', 'event')
      .eq('is_active', true)
      .eq('health_blocked', false)
      .contains('trigger_config', { event: eventType })

    if (wfErr || !wfs || wfs.length === 0) continue

    for (const wf of wfs as OpportunityWorkflowRow[]) {
      const cfg = (wf.trigger_config ?? {}) as Record<string, unknown>

      const { data: opps, error: oppErr } = await supabase
        .from('opportunities')
        .select(
          'id, org_id, stage_id, status, expected_close_date, updated_at, created_at',
        )
        .eq('org_id', wf.org_id)
        .eq('status', 'open')

      if (oppErr || !opps || opps.length === 0) continue

      for (const opp of opps as OpportunityRow[]) {
        const matched = await evaluateOpportunityCondition(
          supabase,
          eventType,
          cfg,
          opp,
          now,
        )
        if (!matched) continue

        // Idempotency: the DB enforces at-most-once per (workflow, opportunity,
        // event) per UTC day via a unique index (migration 1245). We claim the
        // slot by inserting; a duplicate-key error means it already fired today.
        const fireAtIso = now.toISOString()
        const { data: inserted, error: insErr } = await supabase
          .from('scheduled_opportunity_ticks')
          .insert({
            org_id: wf.org_id,
            workflow_id: wf.id,
            opportunity_id: opp.id,
            event_type: eventType,
            fire_at: fireAtIso,
            fired: false,
          })
          .select('id')
          .single()

        if (insErr || !inserted) {
          // Unique violation (already dispatched today) or transient error.
          skipped++
          continue
        }

        const tickId = (inserted as { id: string }).id
        try {
          const snapshot = buildOpportunitySnapshot(eventType, cfg, opp, now)
          await emitOpportunityEvent(wf.org_id, eventType, {
            opportunity_id: opp.id,
            opportunity_snapshot: snapshot,
          })
          await supabase
            .from('scheduled_opportunity_ticks')
            .update({ fired: true, fired_at: new Date().toISOString() })
            .eq('id', tickId)
          dispatched++
        } catch (emitErr) {
          // Emit failed → release the claim so a later tick retries instead of
          // permanently losing the dispatch while the audit says it fired.
          console.error('[calendar-tick] opportunity emit failed, releasing tick:', emitErr)
          await supabase.from('scheduled_opportunity_ticks').delete().eq('id', tickId)
          skipped++
        }
      }
    }
  }

  return { dispatched, skipped }
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000)
}

async function evaluateOpportunityCondition(
  supabase: ReturnType<typeof createClient<Database>>,
  eventType: OpportunityEventType,
  cfg: Record<string, unknown>,
  opp: OpportunityRow,
  now: Date,
): Promise<boolean> {
  switch (eventType) {
    case 'opportunity.aged_in_stage': {
      const days = Number(cfg.days)
      if (!Number.isFinite(days) || days <= 0) return false
      const stageFilter = cfg.stage_id as string | undefined
      if (stageFilter && stageFilter !== opp.stage_id) return false

      // Days since the most recent stage_change activity for this opportunity,
      // or since opportunity created_at if it has never changed stages.
      const { data: lastStageChange } = await supabase
        .from('opportunity_activities')
        .select('created_at')
        .eq('opportunity_id', opp.id)
        .eq('type', 'stage_change')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const reference = lastStageChange?.created_at
        ? new Date(lastStageChange.created_at as string)
        : new Date(opp.created_at)
      return daysBetween(now, reference) >= days
    }

    case 'opportunity.no_activity': {
      const days = Number(cfg.days)
      if (!Number.isFinite(days) || days <= 0) return false

      const { data: lastActivity } = await supabase
        .from('opportunity_activities')
        .select('created_at')
        .eq('opportunity_id', opp.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const reference = lastActivity?.created_at
        ? new Date(lastActivity.created_at as string)
        : new Date(opp.created_at)
      return daysBetween(now, reference) >= days
    }

    case 'opportunity.close_date_approaching': {
      const daysBefore = Number(cfg.days_before)
      if (!Number.isFinite(daysBefore) || daysBefore < 0) return false
      if (!opp.expected_close_date) return false
      const closeDate = new Date(opp.expected_close_date)
      const delta = daysBetween(closeDate, now)
      // Fire on the exact day the opportunity is `days_before` away.
      // delta == daysBefore means the close date is daysBefore full days
      // ahead at the current moment.
      return delta === daysBefore
    }

    case 'opportunity.close_date_passed': {
      if (!opp.expected_close_date) return false
      const closeDate = new Date(opp.expected_close_date)
      return closeDate.getTime() < now.getTime()
    }

    case 'opportunity.stale': {
      const days = Number(cfg.days)
      if (!Number.isFinite(days) || days <= 0) return false
      const reference = new Date(opp.updated_at)
      return daysBetween(now, reference) >= days
    }

    default:
      return false
  }
}

function buildOpportunitySnapshot(
  eventType: OpportunityEventType,
  cfg: Record<string, unknown>,
  opp: OpportunityRow,
  now: Date,
): Record<string, unknown> {
  switch (eventType) {
    case 'opportunity.aged_in_stage':
      return {
        days_in_stage: Number(cfg.days) || null,
        stage_id: opp.stage_id,
      }
    case 'opportunity.no_activity':
      return { days_since_activity: Number(cfg.days) || null }
    case 'opportunity.close_date_approaching':
      return {
        days_before: Number(cfg.days_before) || 0,
        expected_close_date: opp.expected_close_date,
      }
    case 'opportunity.close_date_passed':
      return {
        expected_close_date: opp.expected_close_date,
        passed_at: now.toISOString(),
      }
    case 'opportunity.stale':
      return {
        days_stale: Number(cfg.days) || null,
        updated_at: opp.updated_at,
      }
    default:
      return {}
  }
}

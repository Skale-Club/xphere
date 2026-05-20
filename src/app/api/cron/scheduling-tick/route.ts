// SEED-027 Phase C: time-based workflow tick scheduler.
//
// Invoked by the GitHub Actions workflow `.github/workflows/scheduling-tick.yml`
// (Vercel Hobby crons are capped at daily; GitHub Actions runs every 5 min).
// For each tick window:
//   1. Query active workflows with trigger_type='event' and event in
//      ('meeting.starts_in', 'meeting.ended')
//   2. For each, find bookings whose target moment falls in [now, now + 1min)
//   3. Enqueue exactly once per (workflow, booking, event, fired_minute)
//      using scheduled_workflow_ticks idempotency table — duplicates are
//      safely dropped at the DB level
//   4. Dispatch via lib/scheduling/transition.emitCalendarEvent
//
// The caller sends CRON_SECRET as Authorization: Bearer header — required
// to prevent unauthorized invocations.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { emitCalendarEvent } from '@/lib/scheduling/transition'

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
      .in('status', ['confirmed', 'completed'] as never)
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

      await emitCalendarEvent(
        { supabase, depth: 0 },
        {
          event: 'meeting.ended',
          booking_id: booking.id as string,
          org_id: booking.org_id as string,
        },
      )
      totalDispatched++
    }
  }

  return Response.json({
    ok: true,
    window_start: windowStart,
    dispatched: totalDispatched,
    skipped_already_dispatched: totalSkipped,
  })
}

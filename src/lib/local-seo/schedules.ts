import 'server-only'

// Recurring scans. The tick calls runDueSchedules() before working the queue:
// every active schedule whose next_run_at has passed is claimed (its
// next_run_at moved forward with a conditional UPDATE, so two overlapping
// ticks never run it twice) and one scan per keyword is created through the
// same createScan() path as "Scan now" — quota, kill switch and all.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { createLogger } from '@/lib/obs/logger'

import { createScan } from './scans'

type Admin = SupabaseClient<Database>
type ScheduleRow = Database['public']['Tables']['local_seo_schedules']['Row']

export type Frequency = ScheduleRow['frequency']
export type ScheduleTiming = Pick<ScheduleRow, 'frequency' | 'weekday' | 'day_of_month' | 'hour_utc' | 'minute_utc'>

const MAX_SCHEDULES_PER_TICK = 20
const DAY_MS = 86_400_000

const log = createLogger({ module: 'local-seo/schedules' })

/**
 * First run time strictly after `after`. For biweekly schedules pass the
 * previous run as `previous`, so runs stay two weeks apart.
 */
export function nextRunAt(s: ScheduleTiming, after: Date, previous?: Date | null): Date {
  const at = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.hour_utc, s.minute_utc))

  if (s.frequency === 'daily') {
    const c = at(after)
    return c > after ? c : new Date(c.getTime() + DAY_MS)
  }

  if (s.frequency === 'weekly' || s.frequency === 'biweekly') {
    const floor = s.frequency === 'biweekly' && previous ? new Date(previous.getTime() + 7 * DAY_MS) : after
    const from = floor > after ? floor : after
    let c = at(from)
    c = new Date(c.getTime() + ((((s.weekday - c.getUTCDay()) % 7) + 7) % 7) * DAY_MS)
    return c > from ? c : new Date(c.getTime() + 7 * DAY_MS)
  }

  // monthly
  const thisMonth = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), s.day_of_month, s.hour_utc, s.minute_utc))
  if (thisMonth > after) return thisMonth
  return new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, s.day_of_month, s.hour_utc, s.minute_utc))
}

export type ScheduleRunSummary = { due: number; ran: number; scans: number; errors: number }

export async function runDueSchedules(admin: Admin, now = new Date()): Promise<ScheduleRunSummary> {
  const summary: ScheduleRunSummary = { due: 0, ran: 0, scans: 0, errors: 0 }
  const { data: due, error } = await admin
    .from('local_seo_schedules')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true })
    .limit(MAX_SCHEDULES_PER_TICK)
  if (error) throw new Error(`schedule lookup failed: ${error.message}`)
  summary.due = due?.length ?? 0

  for (const s of due ?? []) {
    // Claim: move next_run_at only if nobody else did it first.
    const next = nextRunAt(s, now, new Date(s.next_run_at))
    const { data: claimed } = await admin
      .from('local_seo_schedules')
      .update({ next_run_at: next.toISOString(), last_run_at: now.toISOString() })
      .eq('id', s.id)
      .eq('next_run_at', s.next_run_at)
      .select('id')
    if (!claimed?.length) continue
    summary.ran++

    let keywordIds = s.keyword_ids
    if (!keywordIds.length) {
      const { data: kws } = await admin
        .from('local_seo_keywords')
        .select('id')
        .eq('location_id', s.location_id)
        .eq('is_active', true)
      keywordIds = (kws ?? []).map((k) => k.id)
    }

    const errors: string[] = []
    for (const keywordId of keywordIds) {
      const res = await createScan(admin, {
        orgId: s.org_id,
        locationId: s.location_id,
        keywordId,
        gridSize: s.grid_size ?? undefined,
        spacingM: s.spacing_m ?? undefined,
        shape: s.shape ?? undefined,
        triggeredBy: 'schedule',
        scheduleId: s.id,
      })
      if (res.ok) summary.scans++
      else {
        errors.push(res.error)
        // Quota and kill-switch errors apply to the remaining keywords too.
        if (/points|paused|capacity/i.test(res.error)) break
      }
    }
    if (errors.length) summary.errors++
    await admin
      .from('local_seo_schedules')
      .update({ last_error: errors.length ? errors[0].slice(0, 500) : null })
      .eq('id', s.id)
    if (errors.length) log.warn('local_seo_schedule_errors', { scheduleId: s.id, errors })
  }
  return summary
}

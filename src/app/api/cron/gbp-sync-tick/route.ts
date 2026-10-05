// src/app/api/cron/gbp-sync-tick/route.ts
//
// Google Business Profile tick (every 15 minutes from skale-cron, against
// origin.xphere.app):
//   1. retry ledger changes left queued by a transient error
//   2. publish scheduled posts that are due
//   3. sync reviews of the least recently synced connected locations
//   4. daily profile snapshot (Google-update detection) and performance pull
// Each location is isolated: one failing location records gbp_sync_error and
// the tick moves on. See src/lib/gbp/sync.ts.
//
// Auth: Authorization: Bearer <CRON_SECRET>, mandatory, fail closed.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { captureApiError } from '@/lib/api-error'
import { runQueuedChanges } from '@/lib/gbp/commands'
import { publishDuePosts, syncPerformance, syncProfile, syncReviews } from '@/lib/gbp/sync'

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const BUDGET_MS = 60_000
const REVIEW_LOCATIONS_PER_TICK = 15
const DAILY_LOCATIONS_PER_TICK = 5

export async function GET(request: Request): Promise<Response> {
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  const started = Date.now()
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const summary = { retried: 0, posts: 0, reviews: 0, newReviews: 0, profiles: 0, performance: 0, errors: 0 }

  try {
    summary.retried = await runQueuedChanges(admin)
    summary.posts = await publishDuePosts(admin)

    const { data: locations } = await admin
      .from('local_seo_locations')
      .select('*')
      .not('gbp_location_name', 'is', null)
      .not('gbp_connection_id', 'is', null)
      .eq('is_active', true)
      .order('gbp_reviews_synced_at', { ascending: true, nullsFirst: true })
      .limit(REVIEW_LOCATIONS_PER_TICK)

    const dayAgo = Date.now() - 86_400_000
    let daily = 0
    for (const loc of locations ?? []) {
      if (Date.now() - started > BUDGET_MS) break
      try {
        const r = await syncReviews(admin, loc)
        summary.reviews++
        summary.newReviews += r.created
        const stale = (ts: string | null) => !ts || new Date(ts).getTime() < dayAgo
        if (daily < DAILY_LOCATIONS_PER_TICK && (stale(loc.gbp_profile_synced_at) || stale(loc.gbp_perf_synced_at))) {
          daily++
          if (stale(loc.gbp_profile_synced_at)) {
            await syncProfile(admin, loc)
            summary.profiles++
          }
          if (stale(loc.gbp_perf_synced_at)) {
            await syncPerformance(admin, loc)
            summary.performance++
          }
        }
      } catch (err) {
        summary.errors++
        await admin
          .from('local_seo_locations')
          .update({
            gbp_sync_error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
            // Push it to the back of the queue so one broken location
            // cannot starve the others.
            gbp_reviews_synced_at: new Date().toISOString(),
          })
          .eq('id', loc.id)
      }
    }
    return Response.json({ ok: true, ...summary, ms: Date.now() - started })
  } catch (err) {
    captureApiError(err, { route: 'api/cron/gbp-sync-tick' })
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'tick failed', ...summary }, { status: 500 })
  }
}

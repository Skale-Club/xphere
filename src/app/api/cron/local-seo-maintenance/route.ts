// src/app/api/cron/local-seo-maintenance/route.ts
//
// Daily Local SEO housekeeping: prunes full SERP results older than 60 days
// (Supabase Free plan budget) and reports scans stuck open. See
// src/lib/local-seo/maintenance.ts.
//
// Schedule: once a day from skale-cron. Auth: Bearer CRON_SECRET, fail closed.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { captureApiError } from '@/lib/api-error'
import { createLogger } from '@/lib/obs/logger'
import { findStuckScans, pruneSerpResults } from '@/lib/local-seo/maintenance'

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

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

  const log = createLogger({ route: 'api/cron/local-seo-maintenance' })
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  try {
    const pruned = await pruneSerpResults(supabase)
    const stuck = await findStuckScans(supabase)
    if (stuck.length) log.warn('local_seo_stuck_scans', { count: stuck.length, scanIds: stuck.map((s) => s.id) })
    return Response.json({ ok: true, pruned, stuck: stuck.length })
  } catch (err) {
    captureApiError(err, { route: 'api/cron/local-seo-maintenance' })
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'maintenance failed' }, { status: 500 })
  }
}
